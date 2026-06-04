import { createGenericProviderAdapter } from './generic-provider-adapter';
import type { ProviderAdapter } from '../../application/ports/provider-adapter';
import { type ProviderName, providerNames } from '../../domain/intelligence';

export const providerAdapters = Object.fromEntries(
  providerNames.map((providerName) => [
    providerName,
    createGenericProviderAdapter(providerName),
  ])
) as Record<ProviderName, ProviderAdapter>;

export function getProviderAdapter(providerName: ProviderName) {
  return providerAdapters[providerName];
}
