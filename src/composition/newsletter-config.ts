import { readRuntimeEnv } from '../platform/env/runtime-env';
/** Shared by deployment generation and the queue runner. */
export const DEFAULT_NEWSLETTER_INVOCATION_SECONDS = 300;
export function newsletterInvocationSeconds(
  environment: Record<string, unknown> = readRuntimeEnv()
): number {
  const seconds = Number(
    environment.NEWSLETTER_INVOCATION_SECONDS ??
      DEFAULT_NEWSLETTER_INVOCATION_SECONDS
  );
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 800)
    throw new Error(
      'NEWSLETTER_INVOCATION_SECONDS must be an integer between 30 and 800'
    );
  return seconds;
}
export function newsletterExecutionConfig() {
  const environment = readRuntimeEnv();
  return {
    durationSeconds: newsletterInvocationSeconds(),
    operatorId:
      typeof environment.LOCAL_AI_OPERATOR_USER_ID === 'string'
        ? environment.LOCAL_AI_OPERATOR_USER_ID
        : undefined,
    paused: environment.NEWSLETTER_WORKERS_PAUSED === 'true',
  };
}
