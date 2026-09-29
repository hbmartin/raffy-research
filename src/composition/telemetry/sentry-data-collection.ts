import type { Options } from '@sentry/core';

/** Explicit opt-out of Sentry 11's automatic payload and identity collection. */
export const sentryDataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  genAI: { inputs: false, outputs: false },
  graphQL: { document: false, variables: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
} satisfies NonNullable<Options['dataCollection']>;
