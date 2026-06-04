import type { ApplicationResult } from '@/modules/kernel/application/result';

/** Produces raw model text for a prompt. Implemented by an LLM infrastructure adapter. */
export interface ReportGeneratorPort {
  generate(input: {
    prompt: string;
  }): Promise<ApplicationResult<{ text: string; modelName: string }>>;
}

/** Sends an internal operational alert (e.g. Slack). No-op when not configured. */
export interface AlertPort {
  sendAlert(input: {
    title: string;
    message: string;
  }): Promise<ApplicationResult<{ type: 'alert_sent' | 'alert_skipped' }>>;
}
