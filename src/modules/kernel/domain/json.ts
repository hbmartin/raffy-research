/**
 * JSON-serializable value types. Use these for persisted jsonb columns and
 * server-function return payloads so values stay transferable across the
 * client/server boundary (the framework rejects bare `unknown`).
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };
