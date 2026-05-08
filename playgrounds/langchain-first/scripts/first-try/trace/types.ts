export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type TraceStatus = "success" | "failure" | "degraded";

export type InternalTraceStatus = TraceStatus | "running";

export type TraceRunnableType =
  | "trace"
  | "agent"
  | "chain"
  | "prompt"
  | "chat_model"
  | "llm"
  | "tool"
  | "retriever"
  | "custom"
  | "unknown";

export interface TraceTiming {
  startedAt: string;
  startedAtMs: number;
  durationMs?: number;
}

export interface TraceErrorRecord {
  name: string;
  message: string;
  stack?: string;
  cause?: JsonValue;
}

export interface TraceTextRecord {
  input?: string;
  output?: string;
}

export interface TraceSpanRecord {
  spanId: string;
  spanParentId?: string;
  name: string;
  status: InternalTraceStatus;
  timing: TraceTiming;
  text?: TraceTextRecord;
  error?: TraceErrorRecord;
}

export interface TraceRecord {
  schemaVersion: "trace.turn.v1";
  traceId: string;
  traceName: string;
  status: TraceStatus;
  tags: string[];
  metadata: JsonValue;
  text?: TraceTextRecord;
  error?: TraceErrorRecord;
  timing: TraceTiming;
  rootSpanIds: string[];
  spans: TraceSpanRecord[];
}

export interface CreateTraceCollectorOptions {
  traceId?: string;
  traceName?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  input?: unknown;
}

export interface FinalizeTraceOptions {
  output?: unknown;
  error?: unknown;
  metadata?: Record<string, unknown>;
}

export interface WriteTraceFileOptions {
  outputDir: string;
  fileName?: string;
}