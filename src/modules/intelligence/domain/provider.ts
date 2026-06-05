import type {
  InternalNoteConfigId,
  ProviderConfigId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';
import type { JsonObject } from '@/modules/kernel/domain/json';

/** All providers the V1 architecture supports. Each is optional per workspace. */
export const PROVIDER_NAMES = [
  'exa',
  'apify',
  'awario',
  'trigify',
  'forumscout',
  'visualping',
  'distill',
  'semrush',
  'ahrefs',
  'slack',
  'notion',
] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

export function isProviderName(value: string): value is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(value);
}

/** Providers that overlap behind a generic capability pattern. */
export const WEBPAGE_MONITOR_PROVIDERS: readonly ProviderName[] = [
  'visualping',
  'distill',
];
export const SEO_PROVIDERS: readonly ProviderName[] = ['semrush', 'ahrefs'];
export const INTERNAL_NOTE_PROVIDERS: readonly ProviderName[] = [
  'slack',
  'notion',
];

export type ProviderConfig = {
  id: ProviderConfigId;
  workspaceId: WorkspaceId;
  providerName: ProviderName;
  enabled: boolean;
  credentialsRef: string | null;
  config: JsonObject | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProviderConfigWriteInput = {
  workspaceId: WorkspaceId;
  providerName: ProviderName;
  enabled: boolean;
  credentialsRef?: string | null;
  config?: JsonObject | null;
};

export type InternalNoteSystem = 'slack' | 'notion';

export type InternalNoteConfig = {
  id: InternalNoteConfigId;
  workspaceId: WorkspaceId;
  sourceSystem: InternalNoteSystem;
  sourceRef: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};
