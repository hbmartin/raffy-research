import { createOpenAI } from '@ai-sdk/openai';
import { generateText, NoObjectGeneratedError, Output } from 'ai';

import type { SourceRecord } from '@/modules/kernel/infrastructure/db/schema';

import type {
  ReportGenerationInput,
  ReportGenerationOutput,
  ReportGenerator,
} from '../../application/ports/report-generator';
import {
  parseReportData,
  type ReportData,
  reportDataSchema,
} from '../../domain/report-schema';

const promptVersion = 'weekly-ceo-market-intelligence-v1';

type OpenAiReportGeneratorOptions = {
  apiKey: string;
  model: string;
};

export class OpenAiReportGenerator implements ReportGenerator {
  readonly #apiKey: string;
  readonly #model: string;

  constructor(options: OpenAiReportGeneratorOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
  }

  async generate(
    input: ReportGenerationInput
  ): Promise<ReportGenerationOutput> {
    const openai = createOpenAI({ apiKey: this.#apiKey });
    const prompt = buildReportPrompt(input);

    try {
      const result = await generateText({
        model: openai(this.#model),
        output: Output.object({
          name: 'WeeklyCeoMarketIntelligenceReport',
          description: 'Evidence-backed weekly CEO market intelligence digest.',
          schema: reportDataSchema,
        }),
        prompt,
      });
      return this.#toOutput(input, result.output);
    } catch (error) {
      const repaired = await this.#repairInvalidOutput({
        error,
        openai,
        prompt,
      });
      return this.#toOutput(input, repaired);
    }
  }

  async #repairInvalidOutput(input: {
    error: unknown;
    openai: ReturnType<typeof createOpenAI>;
    prompt: string;
  }): Promise<ReportData> {
    const invalidText = NoObjectGeneratedError.isInstance(input.error)
      ? (input.error.text ?? '')
      : input.error instanceof Error
        ? input.error.message
        : String(input.error);

    const repair = await generateText({
      model: input.openai(this.#model),
      output: Output.text(),
      prompt: [
        input.prompt,
        '',
        'Repair the following invalid output into only valid JSON for the requested schema.',
        'Do not include markdown fences. Do not add confidence or recommendation fields.',
        invalidText.slice(0, 120_000),
      ].join('\n'),
    });

    return parseReportData(JSON.parse(repair.output) as unknown);
  }

  #toOutput(
    input: ReportGenerationInput,
    reportData: ReportData
  ): ReportGenerationOutput {
    return {
      modelMetadata: {
        model: this.#model,
        promptVersion,
        sourceCount: input.sources.length,
      },
      reportData,
      sourceSummaries: input.sources.map((source) => ({
        evidenceCandidateText: source.contentText?.slice(0, 1000) ?? null,
        sourceRecordId: source.id,
        summaryText:
          source.title ??
          source.contentText?.slice(0, 240) ??
          source.externalUrl ??
          null,
      })),
    };
  }
}

function buildReportPrompt(input: ReportGenerationInput) {
  return [
    'Generate a weekly CEO market intelligence digest as JSON only.',
    'Use the provided schema exactly.',
    'Executive summary must contain exactly 3 bullets.',
    'Every evidence item must include at least one source_ids value from the provided sources.',
    'Do not include confidence fields, recommendation fields, action items, or prescriptive advice.',
    'Frame output as observations and why they may matter, not instructions.',
    '',
    `Workspace ID: ${input.workspace.id}`,
    `Report ID: ${input.reportId}`,
    `Company: ${input.workspace.companyName}`,
    `Company description: ${input.workspace.companyDescription}`,
    `Subcategory: ${input.workspace.subcategory}`,
    `Timezone: ${input.workspace.timezone}`,
    `Period start: ${input.period.periodStart.toISOString()}`,
    `Period end: ${input.period.periodEnd.toISOString()}`,
    '',
    'Required top-level section arrays:',
    [
      'what_looks_most_interesting',
      'contradictions',
      'topic_clusters',
      'competitor_watch',
      'suggested_competitors',
      'market_questions',
      'possible_leads',
      'social_product_feedback',
      'source_library',
    ].join(', '),
    '',
    'Sources:',
    JSON.stringify(input.sources.map(sourceForPrompt), null, 2),
  ].join('\n');
}

function sourceForPrompt(source: SourceRecord) {
  return {
    id: source.id,
    provider_name: source.providerName,
    source_type: source.sourceType,
    title: source.title,
    source_name: source.sourceName,
    external_url: source.externalUrl,
    published_at: source.publishedAt?.toISOString() ?? null,
    captured_at: source.capturedAt.toISOString(),
    excerpt: source.contentText?.slice(0, 2000) ?? '',
    diff_added_text: source.diffAddedText?.slice(0, 1000) ?? '',
    diff_removed_text: source.diffRemovedText?.slice(0, 1000) ?? '',
  };
}
