import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerTelemetry: vi.fn(),
  span: {
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
  },
  startSpan: vi.fn(),
}));

vi.mock('ai', () => ({ registerTelemetry: mocks.registerTelemetry }));
vi.mock('@opentelemetry/api', () => ({
  trace: { getTracer: () => ({ startSpan: mocks.startSpan }) },
  SpanStatusCode: { OK: 1, ERROR: 2, UNSET: 0 },
}));

type Integration = {
  onLanguageModelCallStart: (event: Record<string, unknown>) => void;
  onLanguageModelCallEnd: (event: Record<string, unknown>) => void;
};

async function register(): Promise<Integration> {
  vi.resetModules();
  const { registerAiSdkTelemetry } =
    await import('@/composition/telemetry/ai-sdk-telemetry');
  registerAiSdkTelemetry();
  return mocks.registerTelemetry.mock.calls.at(-1)?.[0] as Integration;
}

describe('AI SDK telemetry integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startSpan.mockReturnValue(mocks.span);
  });

  it('opens an LLM span carrying the prompt', async () => {
    const integration = await register();
    integration.onLanguageModelCallStart({
      callId: 'call-1',
      modelId: 'qwen3:14b',
      provider: 'ollama',
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'Summarize' }] },
      ],
    });

    expect(mocks.startSpan).toHaveBeenCalledWith(
      'ai.languageModelCall',
      expect.objectContaining({
        attributes: expect.objectContaining({
          // OpenInference naming is what makes Phoenix render this as an LLM span.
          'openinference.span.kind': 'LLM',
          'llm.model_name': 'qwen3:14b',
          'llm.provider': 'ollama',
          'input.value': 'user: Summarize',
        }),
      })
    );
  });

  it('closes the matching span with the completion and token counts', async () => {
    const integration = await register();
    integration.onLanguageModelCallStart({
      callId: 'call-1',
      modelId: 'qwen3:14b',
      provider: 'ollama',
      prompt: 'hi',
    });
    integration.onLanguageModelCallEnd({
      callId: 'call-1',
      finishReason: 'stop',
      usage: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500 },
      content: [{ type: 'text', text: '{"summary":"ok"}' }],
    });

    expect(mocks.span.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'output.value': '{"summary":"ok"}',
        'llm.token_count.prompt': 1200,
        'llm.token_count.completion': 300,
        'llm.token_count.total': 1500,
        'llm.finish_reason': 'stop',
      })
    );
    expect(mocks.span.end).toHaveBeenCalledOnce();
  });

  it('ignores an end event with no matching start', async () => {
    const integration = await register();
    integration.onLanguageModelCallEnd({ callId: 'unknown', content: [] });
    expect(mocks.span.end).not.toHaveBeenCalled();
  });

  it('keeps concurrent calls on their own spans', async () => {
    const integration = await register();
    const first = { setAttributes: vi.fn(), setStatus: vi.fn(), end: vi.fn() };
    const second = { setAttributes: vi.fn(), setStatus: vi.fn(), end: vi.fn() };
    mocks.startSpan.mockReturnValueOnce(first).mockReturnValueOnce(second);

    integration.onLanguageModelCallStart({ callId: 'a', prompt: 'a' });
    integration.onLanguageModelCallStart({ callId: 'b', prompt: 'b' });
    integration.onLanguageModelCallEnd({ callId: 'b', content: [] });

    expect(second.end).toHaveBeenCalledOnce();
    expect(first.end).not.toHaveBeenCalled();
  });

  it('registers only once, so spans are not duplicated', async () => {
    vi.resetModules();
    const { registerAiSdkTelemetry } =
      await import('@/composition/telemetry/ai-sdk-telemetry');
    registerAiSdkTelemetry();
    registerAiSdkTelemetry();
    registerAiSdkTelemetry();
    expect(mocks.registerTelemetry).toHaveBeenCalledOnce();
  });
});
