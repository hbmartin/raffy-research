import { Result } from '@swan-io/boxed';
import { z } from 'zod';

import {
  computeWeeklyPeriod,
  evaluateLabReport,
  generateWeeklyReport,
  type LabTextPort,
  type ProviderConfig,
  type ReportGenerationSnapshot,
  runWorkspaceIngest,
  type SourceRecord,
  summarizeLabSource,
  type WeeklyReport,
} from '@/modules/intelligence';
import {
  createLocalAiReportGenerator,
  createOpenAiReportGenerator,
  createProviderRegistry,
  createReportRepository,
  createSourceRepository,
  generateLocalText,
  getLocalAiConfig,
  getProviderCredential,
} from '@/modules/intelligence/backend';
import {
  toSourceRecordId,
  toWeeklyReportId,
  toWorkspaceId,
} from '@/modules/kernel';
import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type {
  BusinessOutcome,
  Operation,
  OperationContext,
  OperationExecutor,
} from '@/modules/operations';
import { operationTransaction } from '@/modules/operations/backend';

import { checkRaffyAccess, type RaffyRuntime } from './raffy-runtime';

/** Dates in persisted JSON snapshots are revived only for known date fields. */
const DATE_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'capturedAt',
  'publishedAt',
  'generatedAt',
  'labeledAt',
  'periodStart',
  'periodEnd',
]);
function reviveSnapshot(value: unknown): unknown {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(reviveSnapshot);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        DATE_FIELDS.has(key) && typeof item === 'string'
          ? new Date(item)
          : reviveSnapshot(item),
      ])
    );
  return value;
}
const stopped = (result: ApplicationResult<BusinessOutcome>) =>
  result.isError() ||
  [
    'reconciliation_required',
    'operation_interrupted',
    'lease_lost',
    'forbidden',
  ].includes(result.get().type);

function labText(
  _runtime: RaffyRuntime,
  operation: Operation,
  context: OperationContext
): LabTextPort {
  return async ({ prompt, label }) => {
    const result = await context.step(`model:${label}`, true, async () => {
      try {
        const config = getLocalAiConfig();
        const output = await generateLocalText({
          provider: z
            .enum(['codex-cli', 'claude-code', 'ollama'])
            .parse(operation.input.provider),
          model: z.string().parse(operation.input.model),
          prompt,
          label,
          action: operation.kind,
          runId: operation.id,
          rawOutputDir: config.rawOutputDir,
          ollamaBaseUrl:
            typeof operation.input.ollamaBaseUrl === 'string'
              ? operation.input.ollamaBaseUrl
              : config.ollamaBaseUrl,
          ollamaNumCtx:
            typeof operation.input.ollamaNumCtx === 'number'
              ? operation.input.ollamaNumCtx
              : undefined,
          abortSignal: AbortSignal.any([
            context.signal,
            AbortSignal.timeout(
              z.number().parse(operation.input.timeoutMs ?? config.timeoutMs)
            ),
          ]),
        });
        return Result.Ok({ type: 'text_generated', ...output });
      } catch (cause) {
        return Result.Error(
          cause instanceof AppError
            ? cause
            : new AppError({
                code: 'LOCAL_MODEL_FAILED',
                category: 'system',
                status: 502,
                cause,
              })
        );
      }
    });
    if (result.isError()) return Result.Error(result.getError());
    const value = result.get();
    if (value.type === 'text_generated')
      return Result.Ok({
        type: 'text_generated',
        text: z.string().parse(value.text),
        modelName: z.string().parse(value.modelName),
        modelProvider: z.string().parse(value.modelProvider),
      });
    return Result.Ok({
      type:
        value.type === 'lease_lost'
          ? 'lease_lost'
          : value.type === 'reconciliation_required'
            ? 'reconciliation_required'
            : 'operation_interrupted',
    });
  };
}

async function evidenceSnapshot(
  runtime: RaffyRuntime,
  operation: Operation,
  context: OperationContext
) {
  return context.step('evidence_snapshot', false, async () => {
    const workspaceId = toWorkspaceId(operation.workspaceId);
    const workspace =
      await runtime.repositories.workspaceRepository.getById(workspaceId);
    if (workspace.isError()) return Result.Error(workspace.getError());
    const found = workspace.get();
    if (found.type !== 'workspace_found') return Result.Ok(found);
    const period = computeWeeklyPeriod(
      new Date(z.string().parse(operation.input.period)),
      found.workspace.timezone
    );
    const ids = z.array(z.string()).parse(operation.input.sourceIds ?? []);
    const sources = ids.length
      ? await runtime.repositories.sourceRepository.getManyByIds(
          workspaceId,
          ids.map(toSourceRecordId)
        )
      : await runtime.repositories.sourceRepository.listForPeriod({
          workspaceId,
          ...period,
        });
    if (sources.isError()) return Result.Error(sources.getError());
    const missing = ids.filter(
      (id) => !sources.get().some((source) => source.id === id)
    );
    if (missing.length)
      return Result.Ok({ type: 'source_record_not_found', sourceIds: missing });
    return Result.Ok({
      type: 'evidence_snapshot',
      sources: sources
        .get()
        .filter((source) => source.relevanceLabel !== 'junk'),
      workspace: found.workspace,
    });
  });
}

async function generationSnapshot(
  runtime: RaffyRuntime,
  operation: Operation,
  context: OperationContext,
  evidence: BusinessOutcome
) {
  return context.step('generation_snapshot', false, async () => {
    const workspaceId = toWorkspaceId(operation.workspaceId);
    const [keywords, competitors, socialAccounts, priorReports] =
      await Promise.all([
        runtime.repositories.workspaceRepository.listKeywords(workspaceId, {
          activeOnly: true,
        }),
        runtime.repositories.workspaceRepository.listCompetitors(workspaceId),
        runtime.repositories.workspaceRepository.listSocialAccounts(
          workspaceId
        ),
        runtime.repositories.reportRepository.listByWorkspace(workspaceId, {
          limit: 4,
        }),
      ]);
    if (keywords.isError()) return Result.Error(keywords.getError());
    if (competitors.isError()) return Result.Error(competitors.getError());
    if (socialAccounts.isError())
      return Result.Error(socialAccounts.getError());
    if (priorReports.isError()) return Result.Error(priorReports.getError());
    const sources = reviveSnapshot(evidence.sources) as SourceRecord[];
    const summaries =
      await runtime.repositories.sourceRepository.listLatestSummariesForSources(
        {
          workspaceId,
          sourceRecordIds: sources.map((source) => source.id),
          modelName: z.string().parse(operation.input.model),
        }
      );
    if (summaries.isError()) return Result.Error(summaries.getError());
    return Result.Ok({
      type: 'generation_snapshot',
      snapshot: {
        workspace: evidence.workspace,
        sources,
        sourceSummaries: summaries.get(),
        keywords: keywords.get(),
        competitors: competitors.get(),
        socialAccounts: socialAccounts.get(),
        priorReports: priorReports.get(),
      },
    });
  });
}

async function evaluate(
  runtime: RaffyRuntime,
  operation: Operation,
  context: OperationContext,
  reportId: string
): Promise<ApplicationResult<BusinessOutcome>> {
  const snapshot = await context.step(
    'evaluation_snapshot',
    false,
    async () => {
      const report = await runtime.repositories.reportRepository.getById(
        toWeeklyReportId(reportId)
      );
      if (report.isError()) return Result.Error(report.getError());
      const found = report.get();
      if (found.type !== 'report_found') return Result.Ok(found);
      if (found.report.workspaceId !== operation.workspaceId)
        return Result.Ok({ type: 'forbidden' });
      const links = await runtime.repositories.reportRepository.listSources(
        found.report.id
      );
      if (links.isError()) return Result.Error(links.getError());
      const sources = await runtime.repositories.sourceRepository.listForPeriod(
        {
          workspaceId: toWorkspaceId(operation.workspaceId),
          periodStart: found.report.periodStart,
          periodEnd: found.report.periodEnd,
        }
      );
      if (sources.isError()) return Result.Error(sources.getError());
      return Result.Ok({
        type: 'evaluation_snapshot',
        report: found.report,
        sources: sources.get(),
      });
    }
  );
  if (
    snapshot.isError() ||
    stopped(snapshot) ||
    snapshot.get().type !== 'evaluation_snapshot'
  )
    return snapshot;
  const value = snapshot.get();
  const result = await evaluateLabReport(
    labText(runtime, operation, context),
    reviveSnapshot(value.report) as WeeklyReport,
    reviveSnapshot(value.sources) as SourceRecord[]
  );
  if (result.isError()) return Result.Error(result.getError());
  const verdict = result.get();
  if (verdict.type !== 'report_evaluated') return Result.Ok(verdict);
  const saved = await context.step('evaluation_saved', false, () =>
    operationTransaction(runtime.db, operation, 'evaluation_saved', (db) => {
      return import('@/modules/intelligence/backend').then(
        ({ createAgentResearch }) =>
          createAgentResearch(db).recordJudgment({
            workspaceId: operation.workspaceId,
            targetId: reportId,
            kind: 'evaluation',
            provenance: {
              origin: 'automated',
              channel: 'cli',
              actorId: operation.userId,
              credentialId: operation.credentialId,
              model: verdict.modelName,
              promptVersion: verdict.promptVersion,
            },
            payload: { ...verdict, operationId: operation.id },
          })
      );
    })
  );
  if (saved.isError() || stopped(saved)) return saved;
  return Result.Ok({ ...verdict, judgment: saved.get().judgment });
}

export function createRaffyExecutor(
  runtime: RaffyRuntime,
  reconcilePublications: (
    workspaceId: string,
    signal: AbortSignal
  ) => Promise<ApplicationResult<{ type: string }>>
): OperationExecutor {
  return async (operation, context) => {
    const authorized = await checkRaffyAccess(
      runtime,
      operation.kind === 'ingest' ||
        operation.kind === 'discover' ||
        operation.input.runtime === 'hosted'
        ? 'pipeline'
        : 'lab'
    );
    if (authorized.isError()) return Result.Error(authorized.getError());
    if (authorized.get().type !== 'authorized')
      return Result.Ok({ type: 'forbidden' });
    if (operation.kind === 'discover')
      return context.step('discovery', true, async () => {
        const found = await runtime.archive.research({
          workspaceId: operation.workspaceId,
          jobId: operation.id,
          queries: [z.string().parse(operation.input.query)],
          pages: z.number().parse(operation.input.pages),
          timeoutMs: 300_000,
          signal: context.signal,
        });
        if (found.isError()) return Result.Error(found.getError());
        return Result.Ok({
          type: 'sources_discovered',
          sourceIds: found.get().map((source) => source.id),
        });
      });
    if (operation.kind === 'ingest' || operation.kind === 'full_workflow') {
      const configs = await context.step(
        'ingestion_inputs',
        false,
        async () => {
          const repository = runtime.repositories.workspaceRepository;
          const id = toWorkspaceId(operation.workspaceId);
          const [workspace, keywords, competitors, socialAccounts, configs] =
            await Promise.all([
              repository.getById(id),
              repository.listKeywords(id, { activeOnly: true }),
              repository.listCompetitors(id),
              repository.listSocialAccounts(id),
              repository.listProviderConfigs(id),
            ]);
          if (workspace.isError()) return Result.Error(workspace.getError());
          if (keywords.isError()) return Result.Error(keywords.getError());
          if (competitors.isError())
            return Result.Error(competitors.getError());
          if (socialAccounts.isError())
            return Result.Error(socialAccounts.getError());
          if (configs.isError()) return Result.Error(configs.getError());
          if (workspace.get().type !== 'workspace_found')
            return Result.Ok({ type: 'workspace_not_found' });
          return Result.Ok({
            type: 'ingestion_inputs',
            workspace: workspace.get(),
            keywords: keywords.get(),
            competitors: competitors.get(),
            socialAccounts: socialAccounts.get(),
            configs: configs.get(),
          });
        }
      );
      if (
        configs.isError() ||
        stopped(configs) ||
        configs.get().type !== 'ingestion_inputs'
      )
        return configs;
      const pinned = reviveSnapshot(configs.get()) as BusinessOutcome & {
        workspace: Awaited<
          ReturnType<typeof runtime.repositories.workspaceRepository.getById>
        > extends Result<infer T, unknown>
          ? T
          : never;
        keywords: ReportGenerationSnapshot['keywords'];
        competitors: ReportGenerationSnapshot['competitors'];
        socialAccounts: ReportGenerationSnapshot['socialAccounts'];
        configs: ProviderConfig[];
      };
      const providers = z
        .array(
          z
            .object({ providerName: z.string(), enabled: z.boolean() })
            .passthrough()
        )
        .parse(configs.get().configs);
      const outcomes: BusinessOutcome[] = [];
      for (const provider of providers.filter((item) => item.enabled)) {
        const registry = createProviderRegistry();
        const ingest = await context.step(
          `ingestion:${provider.providerName}`,
          false,
          () =>
            runWorkspaceIngest(
              {
                ...runtime.repositories,
                workspaceRepository: {
                  ...runtime.repositories.workspaceRepository,
                  getById: async () => Result.Ok(pinned.workspace),
                  listKeywords: async () => Result.Ok(pinned.keywords),
                  listCompetitors: async () => Result.Ok(pinned.competitors),
                  listSocialAccounts: async () =>
                    Result.Ok(pinned.socialAccounts),
                  listProviderConfigs: async () => Result.Ok(pinned.configs),
                },
                registry: {
                  all: () => registry.all(),
                  get: (name) => {
                    const adapter = registry.get(name);
                    if (!adapter?.runDailyIngest) return adapter;
                    return {
                      ...adapter,
                      runDailyIngest: async (request) => {
                        const fetched = await context.step(
                          `provider:${name}`,
                          true,
                          async () => {
                            const output =
                              await adapter.runDailyIngest!(request);
                            return output.isError()
                              ? Result.Error(output.getError())
                              : Result.Ok({
                                  type: 'provider_ingested',
                                  output: output.get(),
                                });
                          }
                        );
                        if (fetched.isError())
                          return Result.Error(fetched.getError());
                        if (fetched.get().type !== 'provider_ingested')
                          return Result.Error(
                            new AppError({
                              code: 'INGESTION_INTERRUPTED',
                              category: 'conflict',
                              status: 409,
                            })
                          );
                        return Result.Ok(
                          reviveSnapshot(
                            fetched.get().output
                          ) as import('@/modules/intelligence').NormalizedIngest
                        );
                      },
                    };
                  },
                },
                credentialResolver: { resolve: getProviderCredential },
                clock: runtime.clock,
                logger: runtime.logger,
              },
              {
                workspaceId: toWorkspaceId(operation.workspaceId),
                providerNames: [provider.providerName],
                executionTime: new Date(
                  z.string().parse(operation.input.period)
                ),
                signal: context.signal,
              }
            )
        );
        if (ingest.isError() || stopped(ingest)) return ingest;
        outcomes.push(ingest.get());
      }
      if (outcomes.some((outcome) => Number(outcome.providersFailed ?? 0) > 0))
        return Result.Ok({
          type: 'workspace_ingestion_failed',
          providers: outcomes,
        });
      if (operation.kind === 'ingest')
        return Result.Ok({ type: 'workspace_ingested', providers: outcomes });
    }
    if (operation.kind === 'evaluate')
      return evaluate(
        runtime,
        operation,
        context,
        z.string().parse(operation.input.reportId)
      );
    const evidence = await evidenceSnapshot(runtime, operation, context);
    if (
      evidence.isError() ||
      stopped(evidence) ||
      evidence.get().type !== 'evidence_snapshot'
    )
      return evidence;
    if (operation.kind === 'summarize' || operation.kind === 'full_workflow') {
      const sources = reviveSnapshot(evidence.get().sources) as SourceRecord[];
      for (const source of sources) {
        const summarized = await context.step(
          `summary_saved:${source.id}`,
          false,
          () =>
            summarizeLabSource(
              {
                generate: labText(runtime, operation, context),
                sources: runtime.repositories.sourceRepository,
                persist: async (input) => {
                  const saved = await operationTransaction(
                    runtime.db,
                    operation,
                    `summary_saved:${source.id}`,
                    async (db) => {
                      const result = await createSourceRepository({
                        db,
                      }).createSourceSummary(input);
                      return result.isError()
                        ? Result.Error(result.getError())
                        : Result.Ok({
                            type: 'source_summarized',
                            summaryId: result.get().id,
                            sourceRecordId: source.id,
                            summary: result.get(),
                            modelName: input.modelName,
                            modelProvider: input.modelProvider,
                          });
                    }
                  );
                  return saved.isError()
                    ? Result.Error(saved.getError())
                    : Result.Ok(saved.get().summary);
                },
              },
              source
            )
        );
        if (summarized.isError() || stopped(summarized)) return summarized;
      }
      if (operation.kind === 'summarize')
        return Result.Ok({
          type: 'sources_summarized',
          sourceIds: sources.map((source) => source.id),
        });
    }
    const captured = await generationSnapshot(
      runtime,
      operation,
      context,
      evidence.get()
    );
    if (
      captured.isError() ||
      stopped(captured) ||
      captured.get().type !== 'generation_snapshot'
    )
      return captured;
    const snapshot = reviveSnapshot(
      captured.get().snapshot
    ) as ReportGenerationSnapshot;
    const config = getLocalAiConfig();
    const generator =
      operation.input.runtime === 'hosted'
        ? createOpenAiReportGenerator({
            model: z.string().parse(operation.input.model),
            signal: context.signal,
          })
        : createLocalAiReportGenerator({
            provider: z
              .enum(['codex-cli', 'claude-code', 'ollama'])
              .parse(operation.input.provider),
            model: z.string().parse(operation.input.model),
            rawOutputDir: config.rawOutputDir,
            runId: operation.id,
            ollamaBaseUrl:
              typeof operation.input.ollamaBaseUrl === 'string'
                ? operation.input.ollamaBaseUrl
                : config.ollamaBaseUrl,
            ollamaNumCtx:
              typeof operation.input.ollamaNumCtx === 'number'
                ? operation.input.ollamaNumCtx
                : undefined,
            abortSignal: AbortSignal.any([
              context.signal,
              AbortSignal.timeout(
                z.number().parse(operation.input.timeoutMs ?? config.timeoutMs)
              ),
            ]),
          });
    const generated = await context.step('publication', false, () =>
      generateWeeklyReport(
        {
          ...runtime.repositories,
          snapshot,
          logger: runtime.logger,
          clock: runtime.clock,
          alert: {
            sendAlert: async () => Result.Ok({ type: 'alert_skipped' }),
          },
          reportGenerator: {
            generate: async (request) => {
              const result = await context.step(
                `model:report:${request.stage ?? 'initial'}`,
                true,
                async () => {
                  const call = await generator.generate(request);
                  return call.isError()
                    ? Result.Error(call.getError())
                    : Result.Ok({ type: 'text_generated', ...call.get() });
                }
              );
              if (result.isError()) return Result.Error(result.getError());
              const output = result.get();
              if (output.type !== 'text_generated')
                return Result.Error(
                  new AppError({
                    code:
                      output.type === 'reconciliation_required'
                        ? 'RECONCILIATION_REQUIRED'
                        : 'OPERATION_INTERRUPTED',
                    category: 'conflict',
                    status: 409,
                  })
                );
              return Result.Ok({
                text: z.string().parse(output.text),
                modelName: z.string().parse(output.modelName),
                modelProvider: z.string().parse(output.modelProvider),
                metadata: { operationId: operation.id },
              });
            },
          },
          publicationTransaction: (work) =>
            operationTransaction(runtime.db, operation, 'publication', (db) =>
              work(createReportRepository({ db }))
            ),
        },
        {
          workspaceId: toWorkspaceId(operation.workspaceId),
          now: new Date(z.string().parse(operation.input.period)),
          includeSourceSummaries: true,
        }
      )
    );
    if (
      generated.isError() ||
      stopped(generated) ||
      generated.get().type !== 'report_published'
    )
      return generated;
    const published = generated.get().report as WeeklyReport;
    const reconciled = await context.step(
      'newsletter_publication',
      false,
      async () => {
        const result = await reconcilePublications(
          operation.workspaceId,
          context.signal
        );
        return result.isError()
          ? Result.Error(result.getError())
          : Result.Ok({ type: 'publication_reconciled' });
      }
    );
    if (reconciled.isError() || stopped(reconciled)) return reconciled;

    if (operation.kind === 'full_workflow') {
      const evaluated = await evaluate(
        runtime,
        operation,
        context,
        published.id
      );
      if (evaluated.isError() || stopped(evaluated)) return evaluated;
      if (evaluated.get().type !== 'report_evaluated')
        return Result.Ok({
          type: 'workflow_evaluation_failed',
          reportId: published.id,
          evaluation: evaluated.get(),
        });
      return Result.Ok({
        type: 'workflow_completed',
        reportId: published.id,
        evaluation: evaluated.get(),
      });
    }
    return Result.Ok({ type: 'report_published', reportId: published.id });
  };
}
