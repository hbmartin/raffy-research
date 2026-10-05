/**
 * One place that turns the Phoenix config into a client.
 *
 * Every command needs the same three lines, and each copy was a chance for
 * the base URL or the auth header to drift apart.
 */
import { getPhoenixConfig } from '@/modules/intelligence/backend';

import { getEvalTelemetryConfig } from './telemetry';

export async function createPhoenixClient() {
  const config = getPhoenixConfig();
  if (!config.enabled) {
    console.error('PHOENIX_APP_URL and PHOENIX_API_KEY must be set');
    process.exit(1);
  }
  const { createClient } = await import('@arizeai/phoenix-client');
  const client = createClient({
    options: {
      baseUrl: config.appUrl,
      headers: { Authorization: `Bearer ${config.apiKey}` },
    },
  });
  const { projectName } = getEvalTelemetryConfig();
  // The SDK has no project-name option and generates a project per experiment.
  // Phoenix's REST endpoint supports project_name; use the public middleware
  // hook so its response and the SDK's task tracer both use our existing project.
  client.use({
    async onRequest({ request, schemaPath }) {
      if (
        request.method !== 'POST' ||
        schemaPath !== '/v1/datasets/{dataset_id}/experiments'
      )
        return;
      const body = await request.clone().json();
      return new Request(request, {
        method: 'POST',
        body: JSON.stringify({ ...body, project_name: projectName }),
      });
    },
  });
  return client;
}
