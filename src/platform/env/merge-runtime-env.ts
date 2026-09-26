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
  // These are artifact properties, never operator-supplied runtime overrides.
  DEV: buildEnv.DEV,
  PROD: buildEnv.PROD,
});

const flagIsTrue = (value: unknown) => value === true || value === 'true';

export const isDevelopmentEnv = (env: RuntimeEnv) =>
  env.DEV === undefined ? env.NODE_ENV === 'development' : flagIsTrue(env.DEV);

export const isProductionEnv = (env: RuntimeEnv) =>
  env.PROD === undefined ? env.NODE_ENV === 'production' : flagIsTrue(env.PROD);
