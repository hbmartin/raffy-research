export type RuntimeEnv = Record<string, unknown>;

/** Keep server validation aligned with Vite's build-time client values. */
export const mergeRuntimeEnv = (
  processEnv: RuntimeEnv,
  buildEnv: RuntimeEnv = {}
): RuntimeEnv => ({
  ...processEnv,
  ...Object.fromEntries(
    Object.entries(buildEnv).filter(([key]) => key.startsWith('VITE_'))
  ),
});
