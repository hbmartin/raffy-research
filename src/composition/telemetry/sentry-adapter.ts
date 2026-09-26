import { sanitizeLogFields } from '@/platform/lib/redaction/sanitize-log-fields';

import {
  type TelemetryAdapter,
  toTelemetryStringTags,
} from '@/platform/telemetry';

/**
 * Minimum shape both `@sentry/node` and `@sentry/react` expose. Captured here
 * so the adapter does not depend on either SDK directly — runtime entries
 * (`sentry.server.ts`, `sentry.client.ts`) construct the adapter and inject
 * the active SDK.
 */
export type SentryLike = {
  captureException: (
    error: unknown,
    context?: {
      tags?: Record<string, string>;
      extra?: Record<string, unknown>;
      fingerprint?: string[];
      level?: 'debug' | 'info' | 'warning' | 'error' | 'fatal';
    }
  ) => string;
  setUser: (
    user: { id: string; email?: string; segment?: string } | null
  ) => void;
  setTag?: (key: string, value: string) => void;
  startSpan?: <T>(
    options: {
      name: string;
      op?: string;
      attributes?: Record<string, string | number | boolean | undefined>;
    },
    fn: () => T
  ) => T;
};

type SentryEventLike = {
  request?: {
    headers?: Record<string, string>;
    method?: string;
    url?: string;
  };
  user?: { id?: string | number; segment?: string; role?: string };
  contexts?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  tags?: Record<string, unknown>;
};

const safeRequestUrl = (value: string | undefined) => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
};

const userAgentHeader = (headers: Record<string, string> | undefined) => {
  if (!headers) return undefined;
  const entry = Object.entries(headers).find(
    ([name, value]) => name.toLowerCase() === 'user-agent' && value
  );
  return entry ? { 'User-Agent': entry[1] } : undefined;
};

const toStringTags = (tags: unknown): Record<string, string> | undefined => {
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) {
    return undefined;
  }

  return toTelemetryStringTags(tags as Record<string, unknown>, {
    allowEmpty: true,
  });
};

export const sanitizeSentryEvent = <TEvent extends SentryEventLike>(
  event: TEvent
): TEvent => {
  const sanitized = sanitizeLogFields({
    contexts: event.contexts ?? {},
    extra: event.extra ?? {},
    tags: event.tags ?? {},
  });

  return {
    ...event,
    ...(event.request && {
      request: {
        method: event.request.method,
        url: safeRequestUrl(event.request.url),
        headers: userAgentHeader(event.request.headers),
      },
    }),
    ...(event.user && {
      user: {
        id: event.user.id,
        segment: event.user.segment,
        role: event.user.role,
      },
    }),
    contexts: sanitized.contexts as Record<string, unknown>,
    extra: sanitized.extra as Record<string, unknown>,
    tags: toStringTags(sanitized.tags),
  };
};

export const createSentryTelemetryAdapter = (
  Sentry: SentryLike
): TelemetryAdapter => ({
  captureException: (error, context) => {
    Sentry.captureException(error, {
      tags: toStringTags(context?.tags),
      extra: context?.extra,
      fingerprint: context?.fingerprint,
      level: context?.level,
    });
  },
  setUser: (user) => {
    if (!user) {
      Sentry.setUser(null);
      Sentry.setTag?.('role', 'none');
      return;
    }
    Sentry.setUser({
      id: user.id,
      segment: user.role ?? undefined,
    });
    Sentry.setTag?.('role', user.role ?? 'none');
  },
  currentCorrelation: () => ({}),
  emitLog: () => {},
  recordMetric: () => {},
  startManualSpan: () => ({
    addEvent: () => {},
    end: () => {},
    recordException: () => {},
    setAttributes: () => {},
    setStatus: () => {},
  }),
  startSpan: (_options, fn) => fn(),
});
