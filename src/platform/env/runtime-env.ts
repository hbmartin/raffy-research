/* oxlint-disable no-process-env */
import { mergeRuntimeEnv, type RuntimeEnv } from './merge-runtime-env';

export const readRuntimeEnv = (): RuntimeEnv => {
  const runtime = typeof process === 'undefined' ? {} : process.env;
  const build = (import.meta as ImportMeta & { env?: RuntimeEnv }).env;
  // Jiti maps import.meta.env to process.env for unbundled CLI entrypoints.
  // That alias is not a source of immutable artifact flags.
  return mergeRuntimeEnv(runtime, build === runtime ? undefined : build);
};
