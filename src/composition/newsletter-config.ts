import { readRuntimeEnv } from '../platform/env/runtime-env';
/** Shared by deployment generation and the queue runner. */
export const DEFAULT_NEWSLETTER_INVOCATION_SECONDS = 800;
export const NEWSLETTER_PERSISTENCE_RESERVE_MS = 30_000;
export function newsletterHostedTimeoutMs(
  environment: Record<string, unknown> = readRuntimeEnv()
): number {
  const timeout = Number(environment.NEWSLETTER_HOSTED_TIMEOUT_MS ?? 600_000);
  if (!Number.isSafeInteger(timeout) || timeout < 1)
    throw new Error('NEWSLETTER_HOSTED_TIMEOUT_MS must be a positive integer');
  return timeout;
}
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
  if (
    seconds * 800 <
    newsletterHostedTimeoutMs(environment) + NEWSLETTER_PERSISTENCE_RESERVE_MS
  )
    throw new Error(
      'Newsletter invocation work time must fit the hosted timeout and 30-second persistence reserve'
    );
  return seconds;
}
export function newsletterExecutionConfig(
  environment: Record<string, unknown> = readRuntimeEnv()
) {
  const localTimeoutMs = Number(environment.LOCAL_AI_TIMEOUT_MS ?? 600_000);
  if (!Number.isSafeInteger(localTimeoutMs) || localTimeoutMs < 1)
    throw new Error('LOCAL_AI_TIMEOUT_MS must be a positive integer');
  const localWorkSeconds = Number(
    environment.NEWSLETTER_LOCAL_WORK_SECONDS ??
      Math.max(900, Math.ceil(localTimeoutMs / 1000) + 60)
  );
  if (
    !Number.isSafeInteger(localWorkSeconds) ||
    localWorkSeconds * 1000 < localTimeoutMs + NEWSLETTER_PERSISTENCE_RESERVE_MS
  )
    throw new Error(
      'NEWSLETTER_LOCAL_WORK_SECONDS must fit the local timeout and 30-second persistence reserve'
    );
  return {
    durationSeconds: newsletterInvocationSeconds(environment),
    hostedTimeoutMs: newsletterHostedTimeoutMs(environment),
    localTimeoutMs,
    localWorkSeconds,
    persistenceReserveMs: NEWSLETTER_PERSISTENCE_RESERVE_MS,
    operatorId:
      typeof environment.LOCAL_AI_OPERATOR_USER_ID === 'string'
        ? environment.LOCAL_AI_OPERATOR_USER_ID
        : undefined,
    paused: environment.NEWSLETTER_WORKERS_PAUSED === 'true',
  };
}
