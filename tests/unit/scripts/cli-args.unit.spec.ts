import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseArgs } from '../../../scripts/eval/cli-args';

/** parseArgs exits on bad input; make that observable instead of fatal. */
class Exited extends Error {}

beforeEach(() => {
  vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Exited('exit');
  }) as never);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const parse = (...argv: string[]) =>
  parseArgs(['node', 'run-phoenix-eval.ts', ...argv]);

describe('parseArgs', () => {
  it('reads a command and workspace', () => {
    const args = parse('compare', '--workspace', 'ws-1');
    expect(args.command).toBe('compare');
    expect(args.workspaceId).toBe('ws-1');
  });

  it('accepts both --flag value and --flag=value', () => {
    expect(parse('compare', '--workspace=ws-1', '--case=dir').caseDir).toBe(
      'dir'
    );
    expect(
      parse('compare', '--workspace', 'ws-1', '--case', 'dir').caseDir
    ).toBe('dir');
  });

  it('rejects an unknown command', () => {
    expect(() => parse('frobnicate', '--workspace', 'ws-1')).toThrow(Exited);
  });

  it('rejects a removed command', () => {
    // generate and full were retired; they used to pass validation, match no
    // handler, and exit zero having done nothing.
    expect(() => parse('generate', '--workspace', 'ws-1')).toThrow(Exited);
    expect(() => parse('full', '--workspace', 'ws-1')).toThrow(Exited);
  });

  it('rejects an unknown option rather than ignoring it', () => {
    expect(() =>
      parse('compare', '--workspace', 'ws-1', '--period', '2026-06-15')
    ).toThrow(Exited);
  });

  it('requires a workspace', () => {
    expect(() => parse('compare')).toThrow(Exited);
  });

  it('rejects an invalid provider', () => {
    expect(() =>
      parse('compare', '--workspace', 'ws-1', '--provider', 'ollma')
    ).toThrow(/--provider/);
  });

  it('rejects a non-numeric count', () => {
    expect(() =>
      parse('summarize', '--workspace', 'ws-1', '--limit', 'abc')
    ).toThrow(/--limit/);
  });

  it('treats a judge model as asking for judges', () => {
    const args = parse(
      'compare',
      '--workspace',
      'ws-1',
      '--judge-model',
      'gpt-5-codex'
    );
    expect(args.judge).toBe(true);
    expect(args.judgeModel).toBe('gpt-5-codex');
  });

  it('maps --sample onto the sample split', () => {
    expect(parse('summarize', '--workspace', 'ws-1', '--sample').split).toBe(
      'sample'
    );
  });

  it('refuses a flag where a value belongs', () => {
    // --case --judge used to consume --judge as the directory, failing on a
    // path that looked like a typo while silently dropping the flag.
    expect(() =>
      parse('compare', '--workspace', 'ws-1', '--case', '--judge')
    ).toThrow(/--case expects a value/);
    expect(() => parse('compare', '--case', 'dir', '--workspace')).toThrow(
      /--workspace expects a value/
    );
  });

  it('collects repeatable options', () => {
    const args = parse(
      'export',
      '--workspace',
      'ws-1',
      '--summary-model',
      'a',
      '--summary-model',
      'b'
    );
    expect(args.summaryModels).toEqual(['a', 'b']);
  });
});
