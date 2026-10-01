import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';
import { registerTelemetry } from 'ai';

/**
 * Emits an OpenTelemetry span per model call made through the AI SDK.
 *
 * v7 changed how this works: `experimental_telemetry: { isEnabled: true }` no
 * longer emits anything on its own -- it means "on, if a telemetry integration
 * is registered" -- and the SDK stopped creating spans itself. Without this
 * registration the AI calls are invisible, while every surrounding db and http
 * span still arrives, which reads like a broken exporter rather than a missing
 * integration.
 *
 * Attributes follow OpenInference naming so Phoenix renders these as LLM
 * spans, with the prompt and completion on the span rather than as loose
 * attributes nobody looks at.
 */
const tracer = trace.getTracer('ai-sdk');

/** Model calls are correlated by callId across the start and end callbacks. */
const openSpans = new Map<string, Span>();

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value ?? null);

/** The prompt as sent, flattened to something readable in a span. */
function promptText(event: Record<string, unknown>): string {
  const prompt = event.prompt ?? event.messages;
  if (typeof prompt === 'string') return prompt;
  if (!Array.isArray(prompt)) return asText(prompt);
  return prompt
    .map((message) => {
      const record = message as Record<string, unknown>;
      const content = Array.isArray(record.content)
        ? record.content
            .map((part) => {
              const p = part as Record<string, unknown>;
              return typeof p.text === 'string' ? p.text : asText(p);
            })
            .join('')
        : asText(record.content);
      return `${String(record.role ?? 'user')}: ${content}`;
    })
    .join('\n');
}

/** Text the model produced, ignoring tool calls and other non-text parts. */
function completionText(content: readonly unknown[] | undefined): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      const record = part as Record<string, unknown>;
      return typeof record.text === 'string' ? record.text : '';
    })
    .join('');
}

let registered = false;

/**
 * Registers the integration once. Safe to call repeatedly; the SDK keeps
 * integrations in a global list and would otherwise double every span.
 */
export function registerAiSdkTelemetry(): void {
  if (registered) return;
  registered = true;

  registerTelemetry({
    onLanguageModelCallStart: (event) => {
      const span = tracer.startSpan('ai.languageModelCall', {
        attributes: {
          'openinference.span.kind': 'LLM',
          'llm.model_name': String(event.modelId ?? ''),
          'llm.provider': String(event.provider ?? ''),
          'input.value': promptText(
            event as unknown as Record<string, unknown>
          ),
          'input.mime_type': 'text/plain',
        },
      });
      openSpans.set(event.callId, span);
    },

    onLanguageModelCallEnd: (event) => {
      const span = openSpans.get(event.callId);
      if (!span) return;
      openSpans.delete(event.callId);

      const usage = event.usage as Record<string, unknown> | undefined;
      span.setAttributes({
        'output.value': completionText(event.content),
        'output.mime_type': 'text/plain',
        'llm.token_count.prompt': Number(usage?.inputTokens ?? 0),
        'llm.token_count.completion': Number(usage?.outputTokens ?? 0),
        'llm.token_count.total': Number(usage?.totalTokens ?? 0),
        'llm.finish_reason': String(event.finishReason ?? ''),
      });
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    },
  });
}
