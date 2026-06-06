import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  codexModel: { id: 'codex-model' },
  createCodexCli: vi.fn(),
  createClaudeCode: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock('ai-sdk-provider-codex-cli', () => ({
  createCodexCli: mocks.createCodexCli,
}));

vi.mock('ai-sdk-provider-claude-code', () => ({
  createClaudeCode: mocks.createClaudeCode,
}));

vi.mock('ai', () => ({
  streamText: mocks.streamText,
}));

const rawOutputDir = 'test-results/local-ai-unit';

async function* fullStreamFixture() {
  yield { type: 'start-step', request: {}, warnings: [] };
  yield {
    type: 'tool-input-start',
    id: 'tool-1',
    toolName: 'web_search',
  };
  yield { type: 'raw', rawValue: { provider: 'test' } };
  yield { type: 'text-delta', id: 'text-1', text: '{"ok":true}' };
  yield {
    type: 'finish-step',
    response: {},
    usage: {},
    finishReason: 'stop',
  };
  yield { type: 'finish', finishReason: 'stop', totalUsage: {} };
}

describe('local AI text generation', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await mkdir(rawOutputDir, { recursive: true });
    mocks.createCodexCli.mockReturnValue(() => mocks.codexModel);
    mocks.createClaudeCode.mockReturnValue(() => mocks.codexModel);
    mocks.streamText.mockReturnValue({ fullStream: fullStreamFixture() });
  });

  afterEach(async () => {
    await rm(rawOutputDir, { recursive: true, force: true });
  });

  it('maps AI SDK stream parts to tool events and raw output metadata', async () => {
    const { generateLocalText } =
      await import('@/modules/intelligence/infrastructure/local-ai/local-text-generator');
    const events: Array<{ type: string; label?: string }> = [];

    const result = await generateLocalText({
      provider: 'codex-cli',
      model: 'gpt-5-codex',
      prompt: 'Return JSON',
      action: 'summarize_sources',
      label: 'source-summary',
      runId: 'run-1',
      rawOutputDir,
      onEvent: (event) => {
        events.push({
          type: event.type,
          label: 'label' in event ? event.label : undefined,
        });
      },
    });

    expect(result.text).toBe('{"ok":true}');
    expect(result.modelProvider).toBe('codex-cli');
    expect(result.metadata.rawFilePath).toEqual(
      expect.stringContaining(
        path.join(rawOutputDir, 'run-1').replaceAll(path.sep, '/')
      )
    );
    expect(events.map((event) => event.type)).toContain('tool_event');
    expect(events.map((event) => event.type)).toContain('artifact');
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mocks.codexModel,
        prompt: 'Return JSON',
        includeRawChunks: true,
      })
    );
  });
});
