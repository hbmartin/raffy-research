import { Result } from '@swan-io/boxed';
import { z } from 'zod';

import { zRubricValues } from '@/modules/intelligence';
import {
  toSourceRecordId,
  toUserId,
  toWeeklyReportId,
  toWorkspaceId,
} from '@/modules/kernel';
import type { ApplicationResult } from '@/modules/kernel/application/result';
import type { BusinessOutcome, PageInput } from '@/modules/operations';
import { transactionDatabase } from '@/modules/operations/backend';

import { createRaffyRuntime, type RaffyRuntime } from './raffy-runtime';

export type CommandOptions = Record<string, string | boolean | undefined>;
export const required = (options: CommandOptions, name: string) =>
  z.string().min(1).max(4000).parse(options[name]);
function assistantProvenance(
  runtime: RaffyRuntime,
  options: CommandOptions
): import('@/modules/intelligence').JudgmentProvenance {
  const string = (name: string) =>
    typeof options[name] === 'string' ? options[name] : undefined;
  return {
    origin: 'assistant',
    channel: 'cli',
    actorId: runtime.identity.userId,
    credentialId: runtime.identity.credentialId,
    agent: string('agent'),
    model: string('model'),
    promptVersion: string('prompt-version'),
    rationale: string('rationale'),
  };
}
export async function researchCommand(
  runtime: RaffyRuntime,
  command: string,
  workspaceId: string,
  options: CommandOptions,
  page: PageInput,
  input?: unknown
): Promise<ApplicationResult<BusinessOutcome>> {
  const userId = toUserId(runtime.identity.userId),
    workspace = toWorkspaceId(workspaceId);
  if (command === 'captures')
    return runtime.research.captures(
      workspaceId,
      required(options, 'source'),
      page
    );
  if (command === 'judgment')
    return runtime.research.judgment(workspaceId, required(options, 'id'));
  if (command === 'workspaces') return runtime.research.workspaces(page);
  if (command === 'reports' || command === 'history')
    return runtime.research.reports(workspaceId, page);
  if (command === 'latest') {
    const result = await runtime.useCases.getLatestReport({
      currentUserId: userId,
      workspaceId: workspace,
    });
    if (result.isError()) return Result.Error(result.getError());
    const value = result.get();
    if (value.type !== 'report_found') return Result.Ok(value);
    const {
      reportData: _data,
      modelMetadata: _metadata,
      ...report
    } = value.report;
    return Result.Ok({ type: 'report_found', report });
  }
  if (command === 'report' || (command === 'evidence' && !options.source)) {
    const reportId = toWeeklyReportId(required(options, 'report'));
    const result = await runtime.useCases.getReport({
      currentUserId: userId,
      reportId,
    });
    if (result.isError()) return Result.Error(result.getError());
    const value = result.get();
    if (value.type !== 'report_found') return Result.Ok(value);
    if (value.report.workspaceId !== workspaceId)
      return Result.Ok({ type: 'forbidden' });
    if (command === 'evidence')
      return runtime.research.sources(workspaceId, page, '', reportId);
    const section = options.section;
    if (typeof section === 'string')
      return Result.Ok({
        type: 'report_section_found',
        reportId,
        section,
        content:
          value.report.reportData?.[
            section as keyof NonNullable<typeof value.report.reportData>
          ] ?? null,
      });
    return Result.Ok(value);
  }
  if (command === 'sources' || command === 'search') {
    const kind = z
      .enum(['captures', 'search-results'])
      .parse(options.kind ?? 'captures');
    if (kind === 'search-results')
      return runtime.research.searchResults(
        workspaceId,
        page,
        typeof options.query === 'string' ? options.query : ''
      );
    return runtime.research.sources(
      workspaceId,
      page,
      typeof options.query === 'string' ? options.query : '',
      typeof options.report === 'string' ? options.report : undefined
    );
  }
  if (command === 'source' || command === 'evidence' || command === 'label') {
    const sourceId = toSourceRecordId(required(options, 'source'));
    const result = await runtime.useCases.getSourceRecord({
      currentUserId: userId,
      sourceRecordId: sourceId,
    });
    if (result.isError()) return Result.Error(result.getError());
    const value = result.get();
    if (value.type !== 'source_record_found') return Result.Ok(value);
    if (value.sourceRecord.workspaceId !== workspaceId)
      return Result.Ok({ type: 'forbidden' });
    if (command === 'label') {
      const label = z.enum(['keep', 'junk', 'clear']).parse(options.label);
      const provenance = assistantProvenance(runtime, options);
      return runtime.db.$runInTransaction!(async (tx) => {
        const transactional = createRaffyRuntime(
          transactionDatabase(runtime.db, tx),
          runtime.credential,
          runtime.identity
        );
        const changed = await transactional.useCases.labelSource({
          currentUserId: userId,
          workspaceId: workspace,
          sourceRecordId: sourceId,
          label: label === 'clear' ? null : label,
          provenance,
        });
        if (changed.isError()) throw changed.getError();
        const labeled = changed.get();
        if (labeled.type !== 'source_labeled') return Result.Ok(labeled);
        return Result.Ok({
          type: 'source_labeled',
          sourceRecordId: sourceId,
          label,
          provenance,
          judgmentId: labeled.judgmentId,
        });
      });
    }
    const {
      rawPayload: _raw,
      contentText,
      diffAddedText,
      diffRemovedText,
      ...sourceRecord
    } = value.sourceRecord;
    return Result.Ok({
      type: 'source_record_found',
      sourceRecord: {
        ...sourceRecord,
        ...(options.content || command === 'evidence'
          ? { contentText, diffAddedText, diffRemovedText }
          : {}),
      },
    });
  }
  if (command === 'judgments')
    return runtime.research.judgments(
      workspaceId,
      required(options, 'target'),
      page
    );
  return rubricCommand(runtime, command, workspaceId, options, page, input);
}

async function rubricCommand(
  runtime: RaffyRuntime,
  command: string,
  workspaceId: string,
  options: CommandOptions,
  page: PageInput,
  input?: unknown
): Promise<ApplicationResult<BusinessOutcome>> {
  const userId = toUserId(runtime.identity.userId),
    workspace = toWorkspaceId(workspaceId);
  if (command === 'promote') {
    if (!options.human)
      return Result.Ok({
        type: 'human_authorization_required',
        recovery:
          'Use --human only after the user explicitly adopts this recommendation.',
      });
    const fetched = await runtime.research.judgment(
      workspaceId,
      required(options, 'id')
    );
    if (fetched.isError()) return Result.Error(fetched.getError());
    const value = fetched.get();
    if (value.type !== 'judgment_found') return Result.Ok(value);
    const record = value.judgment;
    if (
      record.kind !== 'rubric' ||
      record.provenance.origin !== 'assistant' ||
      record.provenance.actorId !== userId
    )
      return Result.Ok({ type: 'recommendation_unavailable' });
    return researchCommand(
      runtime,
      'score',
      workspaceId,
      { ...options, report: record.targetId, promotedFrom: record.id },
      page,
      record.payload
    );
  }
  if (command === 'recommend' || command === 'score') {
    if (command === 'score' && !options.human)
      return Result.Ok({
        type: 'human_authorization_required',
        recovery:
          'Use recommend for assistant judgments; use --human only for user-provided or explicitly adopted values.',
      });
    const values = zRubricValues.parse(input),
      reportId = toWeeklyReportId(required(options, 'report'));
    const report = await runtime.useCases.getReport({
      currentUserId: userId,
      reportId,
    });
    if (report.isError()) return Result.Error(report.getError());
    const found = report.get();
    if (found.type !== 'report_found') return Result.Ok(found);
    if (found.report.workspaceId !== workspaceId)
      return Result.Ok({ type: 'forbidden' });
    if (found.report.status !== 'published')
      return Result.Ok({ type: 'published_report_required' });
    if (!runtime.db.$runInTransaction)
      return Result.Ok({ type: 'transaction_required' });
    return runtime.db.$runInTransaction(async (tx) => {
      const transactional = createRaffyRuntime(
        transactionDatabase(runtime.db, tx),
        runtime.credential,
        runtime.identity
      );
      if (command === 'score') {
        const saved = await transactional.useCases.scoreReport({
          currentUserId: userId,
          workspaceId: workspace,
          reportId,
          ...values,
          provenance: {
            origin: 'human',
            channel: 'cli',
            credentialId: runtime.identity.credentialId,
            promotedFrom:
              typeof options.promotedFrom === 'string'
                ? options.promotedFrom
                : undefined,
          },
        });
        if (saved.isError()) throw saved.getError();
        if (saved.get().type !== 'report_scored') return Result.Ok(saved.get());
      }
      if (command === 'score')
        return Result.Ok({
          type: 'report_scored',
          reportId,
          provenance: {
            origin: 'human',
            channel: 'cli',
            promotedFrom: options.promotedFrom ?? null,
          },
        });
      const recorded = await transactional.research.recordJudgment({
        workspaceId,
        targetId: reportId,
        kind: 'rubric',
        provenance: {
          origin: command === 'recommend' ? 'assistant' : 'human',
          channel: 'cli',
          actorId: userId,
          credentialId: runtime.identity.credentialId,
          agent: typeof options.agent === 'string' ? options.agent : undefined,
          model: typeof options.model === 'string' ? options.model : undefined,
          promptVersion:
            typeof options['prompt-version'] === 'string'
              ? options['prompt-version']
              : undefined,
          rationale:
            typeof options.rationale === 'string'
              ? options.rationale
              : values.note,
          promotedFrom:
            typeof options.promotedFrom === 'string'
              ? options.promotedFrom
              : undefined,
        },
        payload: values,
      });
      if (recorded.isError()) throw recorded.getError();
      return recorded;
    });
  }
  return Result.Ok({ type: 'unknown_command' });
}
