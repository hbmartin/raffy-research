/**
 * Tracing for the CLI.
 *
 * The commands generate through the same AI SDK the app does, but nothing here
 * registered a tracer provider, so those calls were invisible: the experiment
 * wrapper showed up in Phoenix while the generation inside it did not. The AI
 * SDK resolves its tracer from the global provider, which only exists once the
 * server telemetry bootstrap has run.
 */
import {
  flushOpenTelemetryServer,
  initOpenTelemetryServer,
} from '@/composition/telemetry/otel.server';

import { log } from './log';

export function startCliTelemetry(): void {
  // Eval runs are experiments, not application traffic. Filing them under
  // their own Phoenix project keeps a comparison run from being read as
  // production behaviour, and keeps either one legible on its own.
  const adapter = initOpenTelemetryServer({ role: 'evals' });
  if (!adapter) {
    log('Telemetry is not configured; model calls will not be traced');
  }
}

/**
 * The CLI exits explicitly the moment its work is done, which would drop
 * whatever the batch processors had not exported yet.
 */
export async function flushCliTelemetry(): Promise<void> {
  await flushOpenTelemetryServer();
}
