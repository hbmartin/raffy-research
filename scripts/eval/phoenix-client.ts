/**
 * One place that turns the Phoenix config into a client.
 *
 * Every command needs the same three lines, and each copy was a chance for
 * the base URL or the auth header to drift apart.
 */
import { getPhoenixConfig } from '@/modules/intelligence/backend';

export async function createPhoenixClient() {
  const config = getPhoenixConfig();
  if (!config.enabled) {
    console.error('PHOENIX_APP_URL and PHOENIX_API_KEY must be set');
    process.exit(1);
  }
  const { createClient } = await import('@arizeai/phoenix-client');
  return createClient({
    options: {
      baseUrl: config.appUrl,
      headers: { Authorization: `Bearer ${config.apiKey}` },
    },
  });
}
