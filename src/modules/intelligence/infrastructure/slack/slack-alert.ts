import { Result } from '@swan-io/boxed';

import { getSlackAlertWebhookUrl } from '../config/runtime';
import type { AlertPort } from '../../application/ports/report-generator';

/**
 * Best-effort Slack alerting via an incoming webhook. Alerts never fail the
 * caller: a missing webhook is skipped, and delivery errors are swallowed.
 */
export function createSlackAlert(): AlertPort {
  return {
    async sendAlert({ title, message }) {
      const url = getSlackAlertWebhookUrl();
      if (!url) return Result.Ok({ type: 'alert_skipped' });
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: `*${title}*\n${message}` }),
        });
        return Result.Ok({ type: 'alert_sent' });
      } catch {
        return Result.Ok({ type: 'alert_skipped' });
      }
    },
  };
}
