import { describe, expect, it } from 'vitest';

import {
  parsePositiveInt,
  parseProvider,
} from '../../../scripts/eval/cli-values';

describe('parseProvider', () => {
  it('accepts every configured provider', () => {
    expect(parseProvider('ollama', '--provider')).toBe('ollama');
    expect(parseProvider('codex-cli', '--provider')).toBe('codex-cli');
    expect(parseProvider('claude-code', '--provider')).toBe('claude-code');
  });

  it('rejects a typo rather than silently running another model', () => {
    // createModel falls through to Claude Code for anything it does not
    // recognise, so an unvalidated typo ran a different provider.
    expect(() => parseProvider('ollma', '--provider')).toThrow(/--provider/);
    expect(() => parseProvider('ollma', '--provider')).toThrow(/ollama/);
  });

  it('rejects a missing value', () => {
    expect(() => parseProvider(undefined, '--judge-provider')).toThrow(
      /--judge-provider/
    );
  });
});

describe('parsePositiveInt', () => {
  it('accepts a positive whole number', () => {
    expect(parsePositiveInt('10', '--limit')).toBe(10);
  });

  it('rejects text, which previously became NaN', () => {
    expect(() => parsePositiveInt('abc', '--limit')).toThrow(/--limit/);
  });

  it('rejects zero, negatives and fractions', () => {
    expect(() => parsePositiveInt('0', '--concurrency')).toThrow();
    expect(() => parsePositiveInt('-3', '--concurrency')).toThrow();
    expect(() => parsePositiveInt('2.5', '--sample-size')).toThrow();
  });

  it('rejects a missing value', () => {
    expect(() => parsePositiveInt(undefined, '--limit')).toThrow(/--limit/);
  });
});
