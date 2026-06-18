import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  codexModel: { id: 'codex-model' },
  ollamaModel: { id: 'ollama-model' },
  createCodexCli: vi.fn(),
  createClaudeCode: vi.fn(),
  createOllama: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock('ai-sdk-provider-codex-cli', () => ({
  createCodexCli: mocks.createCodexCli,
}));

vi.mock('ai-sdk-provider-claude-code', () => ({
  createClaudeCode: mocks.createClaudeCode,
}));

vi.mock('ollama-ai-provider-v2', () => ({
  createOllama: mocks.createOllama,
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
    mocks.createOllama.mockReturnValue(() => mocks.ollamaModel);
    mocks.streamText.mockReturnValue({ fullStream: fullStreamFixture() });
  });

  afterEach(async () => {
    await rm(rawOutputDir, { recursive: true, force: true });
  });

  it('maps AI SDK stream parts to tool events and raw output metadata', async () => {
    const { generateLocalText } =
      await import('@/modules/intelligence/infrastructure/local-ai/local-text-generator');
    const events: Array<{ type: string; label?: string }> = [];
    const abortController = new AbortController();

    const result = await generateLocalText({
      provider: 'codex-cli',
      model: 'gpt-5-codex',
      prompt: 'Return JSON',
      action: 'summarize_sources',
      label: 'source-summary',
      runId: 'run-1',
      rawOutputDir,
      abortSignal: abortController.signal,
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
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['start', 'tool_event', 'artifact', 'done'])
    );
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mocks.codexModel,
        prompt: 'Return JSON',
        includeRawChunks: true,
        abortSignal: abortController.signal,
      })
    );
    expect(mocks.createCodexCli).toHaveBeenCalledWith({
      defaultSettings: {
        approvalMode: 'never',
        sandboxMode: 'read-only',
        skipGitRepoCheck: true,
        allowNpx: false,
        cwd: process.cwd(),
        logger: false,
      },
    });
  });

  it('preserves abort errors instead of wrapping them as generation failures', async () => {
    const { generateLocalText } =
      await import('@/modules/intelligence/infrastructure/local-ai/local-text-generator');
    const abortController = new AbortController();
    const events: Array<{ type: string; message?: string }> = [];
    abortController.abort('cancelled by user');

    await expect(
      generateLocalText({
        provider: 'codex-cli',
        model: 'gpt-5-codex',
        prompt: 'Return JSON',
        action: 'summarize_sources',
        label: 'source-summary',
        runId: 'run-aborted',
        rawOutputDir,
        abortSignal: abortController.signal,
        onEvent: (event) => {
          events.push({
            type: event.type,
            message: 'message' in event ? event.message : undefined,
          });
        },
      })
    ).rejects.toMatchObject({
      code: 'LOCAL_AI_GENERATION_ABORTED',
      status: 499,
      message: 'cancelled by user',
    });

    expect(mocks.streamText).not.toHaveBeenCalled();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          message: 'cancelled by user',
        }),
      ])
    );
  });

  it('configures claude code with no write, bash, read, or web tools', async () => {
    const { generateLocalText } =
      await import('@/modules/intelligence/infrastructure/local-ai/local-text-generator');

    await generateLocalText({
      provider: 'claude-code',
      model: 'claude-sonnet',
      prompt: 'Return JSON',
      action: 'summarize_sources',
      label: 'source-summary',
      runId: 'run-claude',
      rawOutputDir,
    });

    expect(mocks.createClaudeCode).toHaveBeenCalledWith({
      defaultSettings: {
        allowedTools: [],
        disallowedTools: [
          'Bash',
          'Edit',
          'Glob',
          'Grep',
          'LS',
          'MultiEdit',
          'NotebookEdit',
          'Read',
          'WebFetch',
          'WebSearch',
          'Write',
        ],
        permissionMode: 'dontAsk',
        settingSources: [],
        cwd: process.cwd(),
        logger: false,
        streamingInput: 'auto',
      },
    });
  });

  it('configures ollama with custom base URL', async () => {
    mocks.streamText.mockReturnValue({ fullStream: fullStreamFixture() });
    const { generateLocalText } =
      await import('@/modules/intelligence/infrastructure/local-ai/local-text-generator');

    await generateLocalText({
      provider: 'ollama',
      model: 'llama3.1',
      prompt: 'Return JSON',
      action: 'summarize_sources',
      label: 'source-summary',
      runId: 'run-ollama',
      rawOutputDir,
      ollamaBaseUrl: 'http://custom-host:11434/api',
    });

    expect(mocks.createOllama).toHaveBeenCalledWith({
      baseURL: 'http://custom-host:11434/api',
    });
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mocks.ollamaModel,
        prompt: 'Return JSON',
      })
    );
  });

  it('uses default ollama base URL when none provided', async () => {
    mocks.streamText.mockReturnValue({ fullStream: fullStreamFixture() });
    const { generateLocalText } =
      await import('@/modules/intelligence/infrastructure/local-ai/local-text-generator');

    await generateLocalText({
      provider: 'ollama',
      model: 'llama3.1',
      prompt: 'Return JSON',
      action: 'summarize_sources',
      label: 'source-summary',
      runId: 'run-ollama-default',
      rawOutputDir,
    });

    expect(mocks.createOllama).toHaveBeenCalledWith({
      baseURL: 'http://localhost:11434/api',
    });
  });
});
