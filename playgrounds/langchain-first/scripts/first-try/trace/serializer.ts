import { JsonValue, TraceErrorRecord } from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serializeIterable(value: Iterable<unknown>, seen: WeakSet<object>): JsonValue[] {
  const items: JsonValue[] = [];

  for (const item of value) {
    items.push(toJsonValue(item, seen));
  }

  return items;
}

export function serializeError(error: unknown): TraceErrorRecord {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause === undefined ? undefined : toJsonValue(error.cause),
    };
  }

  return {
    name: "UnknownError",
    message: typeof error === "string" ? error : "Unknown error",
    cause: typeof error === "string" ? undefined : toJsonValue(error),
  };
}

export function toJsonValue(value: unknown, seen = new WeakSet<object>()): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return { type: "bigint", value: value.toString() };
  }

  if (typeof value === "symbol") {
    return { type: "symbol", value: String(value) };
  }

  if (typeof value === "function") {
    return { type: "function", value: value.name || "anonymous" };
  }

  if (value instanceof Date) {
    return { type: "date", value: value.toISOString() };
  }

  if (value instanceof Error) {
    const serialized = serializeError(value);
    return {
      type: "error",
      name: serialized.name,
      message: serialized.message,
      stack: serialized.stack ?? null,
      cause: serialized.cause ?? null,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item, seen));
  }

  if (value instanceof Map) {
    return {
      type: "map",
      entries: Array.from(value.entries()).map(([key, item]) => [toJsonValue(key, seen), toJsonValue(item, seen)]),
    };
  }

  if (value instanceof Set) {
    return {
      type: "set",
      values: Array.from(value.values()).map((item) => toJsonValue(item, seen)),
    };
  }

  if (value instanceof URL) {
    return { type: "url", value: value.toString() };
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return { type: "circular_ref" };
    }

    seen.add(value);

    if (typeof (value as { toJSON?: () => unknown }).toJSON === "function") {
      try {
        return toJsonValue((value as { toJSON: () => unknown }).toJSON(), seen);
      } catch {
        return { type: "toJSON_error", value: String(value) };
      }
    }

    if (isPlainObject(value)) {
      const record: Record<string, JsonValue> = {};

      for (const [key, item] of Object.entries(value)) {
        record[key] = toJsonValue(item, seen);
      }

      return record;
    }

    if (Symbol.iterator in value && typeof (value as Iterable<unknown>)[Symbol.iterator] === "function") {
      return {
        type: value.constructor?.name || "iterable",
        values: serializeIterable(value as Iterable<unknown>, seen),
      };
    }

    const record: Record<string, JsonValue> = {
      type: value.constructor?.name || "object",
    };

    for (const [key, item] of Object.entries(value)) {
      record[key] = toJsonValue(item, seen);
    }

    return record;
  }

  return String(value);
}

function joinTextParts(parts: Array<string | undefined>): string | undefined {
  const normalized = parts.map((item) => item?.trim()).filter((item): item is string => Boolean(item));

  if (normalized.length === 0) {
    return undefined;
  }

  return normalized.join("\n");
}

function toTextFromObject(value: Record<string, unknown>, seen: WeakSet<object>): string | undefined {
  if (typeof value.text === "string") {
    return value.text;
  }

  if ("content" in value) {
    return toTextValue(value.content, seen);
  }

  if ("messages" in value) {
    return toTextValue(value.messages, seen);
  }

  if ("generations" in value) {
    return toTextValue(value.generations, seen);
  }

  if ("message" in value) {
    return toTextValue(value.message, seen);
  }

  if ("kwargs" in value) {
    return toTextValue(value.kwargs, seen);
  }

  const serialized = toJsonValue(value);

  if (typeof serialized === "string") {
    return serialized;
  }

  return JSON.stringify(serialized, null, 2);
}

export function toTextValue(value: unknown, seen = new WeakSet<object>()): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return joinTextParts(value.map((item) => toTextValue(item, seen)));
  }

  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return undefined;
    }

    seen.add(value);

    if (typeof (value as { toJSON?: () => unknown }).toJSON === "function") {
      try {
        return toTextValue((value as { toJSON: () => unknown }).toJSON(), seen);
      } catch {
        return String(value);
      }
    }

    if (isPlainObject(value)) {
      return toTextFromObject(value, seen);
    }

    if (Symbol.iterator in value && typeof (value as Iterable<unknown>)[Symbol.iterator] === "function") {
      return joinTextParts(Array.from(value as Iterable<unknown>, (item) => toTextValue(item, seen)));
    }

    return toTextFromObject(value as Record<string, unknown>, seen);
  }

  return String(value);
}