import { apifyAdapter } from './apify';
import { exaAdapter } from './exa';
import { ahrefsAdapter, semrushAdapter } from './seo';
import {
  awarioAdapter,
  forumscoutAdapter,
  trigifyAdapter,
} from './social-listening';
import { distillAdapter, visualpingAdapter } from './webpage-monitor';
import type {
  ProviderAdapter,
  ProviderRegistry,
} from '../../application/ports/provider-adapter';

const ADAPTERS: ProviderAdapter[] = [
  exaAdapter,
  apifyAdapter,
  awarioAdapter,
  trigifyAdapter,
  forumscoutAdapter,
  visualpingAdapter,
  distillAdapter,
  semrushAdapter,
  ahrefsAdapter,
];

export function createProviderRegistry(): ProviderRegistry {
  const byName = new Map<string, ProviderAdapter>(
    ADAPTERS.map((adapter) => [adapter.name, adapter])
  );
  return {
    get: (name) => byName.get(name),
    all: () => [...ADAPTERS],
  };
}
