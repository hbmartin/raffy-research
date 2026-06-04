import type { JsonObject, JsonValue } from '@/modules/kernel/domain/json';

/** Defensive accessors for untyped provider JSON payloads. */

export const asObject = (value: JsonValue | undefined): JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};

export const asArray = (value: JsonValue | undefined): JsonValue[] =>
  Array.isArray(value) ? value : [];

export const asString = (value: JsonValue | undefined): string | null =>
  typeof value === 'string' ? value : null;

export const asNumber = (value: JsonValue | undefined): number | null =>
  typeof value === 'number' ? value : null;

export const pick = (value: JsonValue | undefined, key: string): JsonValue =>
  asObject(value)[key] ?? null;

export const toDate = (value: JsonValue | undefined): Date | null => {
  const str = asString(value);
  if (!str) return null;
  const time = Date.parse(str);
  return Number.isNaN(time) ? null : new Date(time);
};
