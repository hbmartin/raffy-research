import type { Plugin } from 'vite';

export const productionBuildMarker = (): Plugin => ({
  name: 'raffy:production-build-marker',
  config() {
    return { define: {} };
  },
  configResolved(config) {
    const key = 'import.meta.env.RAFFY_PRODUCTION_BUILD';
    const value = JSON.stringify(
      config.command === 'build' && config.isProduction
    );
    config.define![key] = value;
    for (const environment of Object.values(config.environments)) {
      environment.define![key] = value;
    }
  },
});
