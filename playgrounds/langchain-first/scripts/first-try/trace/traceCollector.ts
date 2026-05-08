import { randomUUID } from "node:crypto";

import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { AgentAction, AgentFinish } from "@langchain/core/agents";
import { BaseMessage } from "@langchain/core/messages";
import { DocumentInterface } from "@langchain/core/documents";
import { LLMResult } from "@langchain/core/outputs";
import { Serialized } from "@langchain/core/load/serializable";
import { ChainValues } from "@langchain/core/utils/types";

import {
  CreateTraceCollectorOptions,
  FinalizeTraceOptions,
  InternalTraceStatus,
  JsonValue,
  TraceErrorRecord,
  TraceRecord,
  TraceRunnableType,
  TraceSpanRecord,
  TraceStatus,
  TraceTextRecord,
  TraceTiming,
} from "./types.js";
import { serializeError, toJsonValue, toTextValue } from "./serializer.js";

type TraceRunNode = {
  runId: string;
  parentRunId?: string;
  runnableType: TraceRunnableType;
  name: string;
  kept: boolean;
};

type MutableTraceSpan = TraceSpanRecord & {
  runnableType: TraceRunnableType;
};

const BUSINESS_RUNNABLE_TYPES = new Set<TraceRunnableType>([
  "agent",
  "prompt",
  "chat_model",
  "llm",
  "tool",
  "retriever",
]);

const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const INTERNAL_NAMES = new Set(["LangGraph", "__start__", "__end__", "chain", "unknown"]);

function createTiming(startMs: number): TraceTiming {
  return {
    startedAt: new Date(startMs).toISOString(),
    startedAtMs: startMs,
  };
}

function finishTiming(timing: TraceTiming, endMs: number) {
  timing.durationMs = endMs - timing.startedAtMs;
}

function inferRunnableType(eventName: string, fallback: TraceRunnableType = "unknown"): TraceRunnableType {
  if (eventName.includes("chat_model")) {
    return "chat_model";
  }

  if (eventName.includes("llm")) {
    return "llm";
  }

  if (eventName.includes("prompt")) {
    return "prompt";
  }

  if (eventName.includes("tool")) {
    return "tool";
  }

  if (eventName.includes("retriever")) {
    return "retriever";
  }

  if (eventName.includes("chain")) {
    return fallback === "unknown" ? "chain" : fallback;
  }

  if (eventName.includes("agent")) {
    return "agent";
  }

  return fallback;
}

function inferTraceStatus(error?: TraceErrorRecord): TraceStatus {
  return error ? "failure" : "success";
}

function inferSpanStatus(error?: TraceErrorRecord): InternalTraceStatus {
  return error ? "failure" : "success";
}

function cloneSpan(span: MutableTraceSpan): TraceSpanRecord {
  const { runnableType: _runnableType, ...traceSpan } = span;
  return traceSpan;
}

function isInternalName(name: string): boolean {
  if (!name.trim()) {
    return true;
  }

  return INTERNAL_NAMES.has(name) || UUID_LIKE_PATTERN.test(name);
}

function shouldKeepSpan(runnableType: TraceRunnableType, name: string): boolean {
  if (BUSINESS_RUNNABLE_TYPES.has(runnableType)) {
    return true;
  }

  if (runnableType === "chain") {
    return !isInternalName(name);
  }

  return false;
}

export class LangChainTraceCollector extends BaseCallbackHandler {
  name = "langchain_json_trace_collector";

  private readonly traceStartedAtMs = Date.now();
  private readonly traceId: string;
  private readonly traceName: string;
  private readonly traceTags: string[];
  private readonly spans = new Map<string, MutableTraceSpan>();
  private readonly runs = new Map<string, TraceRunNode>();
  private readonly traceMetadata: Record<string, JsonValue>;
  private traceText?: TraceTextRecord;
  private traceError?: TraceErrorRecord;

  constructor(options: CreateTraceCollectorOptions = {}) {
    super({
      ignoreLLM: false,
      ignoreChain: false,
      ignoreAgent: false,
      ignoreRetriever: false,
      ignoreCustomEvent: false,
      raiseError: false,
      _awaitHandler: true,
    });

    this.traceId = options.traceId ?? randomUUID();
    this.traceName = options.traceName ?? "langchain-turn-trace";
    this.traceTags = [...(options.tags ?? [])];
    this.traceMetadata = toJsonValue(options.metadata ?? {}) as Record<string, JsonValue>;
    this.traceText = options.input === undefined ? undefined : { input: toTextValue(options.input) };
  }

  getTraceId(): string {
    return this.traceId;
  }

  finalize(options: FinalizeTraceOptions = {}): TraceRecord {
    const endMs = Date.now();

    if (options.output !== undefined) {
      this.traceText = {
        ...this.traceText,
        output: toTextValue(options.output),
      };
    }

    if (options.error !== undefined) {
      this.traceError = serializeError(options.error);
    }

    if (options.metadata) {
      Object.assign(this.traceMetadata, toJsonValue(options.metadata) as Record<string, JsonValue>);
    }

    const spans = Array.from(this.spans.values()).sort((left, right) => left.timing.startedAtMs - right.timing.startedAtMs);
    const rootSpanIds = spans.filter((span) => !span.spanParentId).map((span) => span.spanId);
    const traceTiming = createTiming(this.traceStartedAtMs);
    finishTiming(traceTiming, endMs);

    return {
      schemaVersion: "trace.turn.v1",
      traceId: this.traceId,
      traceName: this.traceName,
      status: inferTraceStatus(this.traceError),
      tags: [...this.traceTags],
      metadata: this.traceMetadata,
      text: this.traceText,
      error: this.traceError,
      timing: traceTiming,
      rootSpanIds,
      spans: spans.map(cloneSpan),
    };
  }

  private ensureSpan(params: {
    spanId: string;
    spanParentId?: string;
    name: string;
    runnableType: TraceRunnableType;
    startedAtMs?: number;
    input?: unknown;
  }): MutableTraceSpan {
    const existing = this.spans.get(params.spanId);

    if (existing) {
      if (params.input !== undefined) {
        existing.text = {
          ...existing.text,
          input: toTextValue(params.input),
        };
      }

      return existing;
    }

    const startedAtMs = params.startedAtMs ?? Date.now();
    const span: MutableTraceSpan = {
      spanId: params.spanId,
      spanParentId: params.spanParentId,
      name: params.name,
      runnableType: params.runnableType,
      status: "running",
      timing: createTiming(startedAtMs),
      text: params.input === undefined ? undefined : { input: toTextValue(params.input) },
    };

    this.spans.set(span.spanId, span);

    return span;
  }

  private registerRun(params: {
    runId: string;
    parentRunId?: string;
    name: string;
    runnableType: TraceRunnableType;
  }): TraceRunNode {
    const kept = shouldKeepSpan(params.runnableType, params.name);
    const node: TraceRunNode = {
      runId: params.runId,
      parentRunId: params.parentRunId,
      runnableType: params.runnableType,
      name: params.name,
      kept,
    };

    this.runs.set(params.runId, node);
    return node;
  }

  private resolveParentSpanId(parentRunId?: string): string | undefined {
    let currentRunId = parentRunId;

    while (currentRunId) {
      const runNode = this.runs.get(currentRunId);

      if (!runNode) {
        return undefined;
      }

      if (runNode.kept) {
        return runNode.runId;
      }

      currentRunId = runNode.parentRunId;
    }

    return undefined;
  }

  private startSpan(params: {
    runId: string;
    parentRunId?: string;
    name: string;
    runnableType: TraceRunnableType;
    input?: unknown;
    startedAtMs?: number;
  }) {
    const run = this.registerRun({
      runId: params.runId,
      parentRunId: params.parentRunId,
      name: params.name,
      runnableType: params.runnableType,
    });

    if (!run.kept) {
      return;
    }

    this.ensureSpan({
      spanId: params.runId,
      spanParentId: this.resolveParentSpanId(params.parentRunId),
      name: params.name,
      runnableType: params.runnableType,
      startedAtMs: params.startedAtMs,
      input: params.input,
    });
  }

  private completeSpan(params: {
    spanId: string;
    output?: unknown;
    error?: unknown;
    status?: TraceStatus;
  }) {
    const span = this.spans.get(params.spanId);

    if (!span) {
      return;
    }

    const endedAtMs = Date.now();
    finishTiming(span.timing, endedAtMs);

    if (params.output !== undefined) {
      span.text = {
        ...span.text,
        output: toTextValue(params.output),
      };
    }

    if (params.error !== undefined) {
      span.error = serializeError(params.error);
    }

    span.status = params.status ?? inferSpanStatus(span.error);
  }

  override handleChatModelStart(
    _llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string
  ) {
    this.startSpan({
      runId,
      parentRunId,
      name: runName ?? "chat_model",
      runnableType: "chat_model",
      input: { messages },
    });
  }

  override handleLLMStart(
    _llm: Serialized,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string
  ) {
    this.startSpan({
      runId,
      parentRunId,
      name: runName ?? "llm",
      runnableType: "llm",
      input: { prompts },
    });
  }

  override handleChainStart(
    _chain: Serialized,
    inputs: ChainValues,
    runId: string,
    runType?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
    parentRunId?: string,
    extra?: Record<string, unknown>
  ) {
    const runnableType = inferRunnableType(`on_${runType ?? "chain"}_start`, (runType as TraceRunnableType | undefined) ?? "chain");
    this.startSpan({
      runId,
      parentRunId,
      name: runName ?? runType ?? "chain",
      runnableType,
      input: inputs,
    });
  }

  override handleToolStart(
    _tool: Serialized,
    input: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
    toolCallId?: string
  ) {
    this.startSpan({
      runId,
      parentRunId,
      name: runName ?? "tool",
      runnableType: "tool",
      input,
    });
  }

  override handleRetrieverStart(
    _retriever: Serialized,
    query: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    name?: string
  ) {
    this.startSpan({
      runId,
      parentRunId,
      name: name ?? "retriever",
      runnableType: "retriever",
      input: { query },
    });
  }

  override handleLLMNewToken(
    token: string,
    idx: { prompt: number; completion: number },
    runId: string,
    parentRunId?: string,
    tags?: string[],
    fields?: { chunk?: unknown }
  ) {}

  override handleText(text: string, runId: string, parentRunId?: string, tags?: string[]) {}

  override handleToolEvent(chunk: unknown, runId: string, parentRunId?: string, tags?: string[]) {}

  override handleAgentAction(action: AgentAction, runId: string, parentRunId?: string, tags?: string[]) {}

  override handleAgentEnd(action: AgentFinish, runId: string, parentRunId?: string, tags?: string[]) {}

  override handleCustomEvent(
    eventName: string,
    data: unknown,
    runId: string,
    tags?: string[],
    metadata?: Record<string, unknown>
  ) {
    this.registerRun({ runId, parentRunId: undefined, name: eventName, runnableType: "custom" });
  }

  override handleChatModelStreamEvent(event: unknown, runId: string, parentRunId?: string, tags?: string[]) {}

  override handleLLMEnd(
    output: LLMResult,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    extraParams?: Record<string, unknown>
  ) {
    this.completeSpan({ spanId: runId, output });
  }

  override handleChainEnd(
    outputs: ChainValues,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    kwargs?: { inputs?: Record<string, unknown> }
  ) {
    this.completeSpan({ spanId: runId, output: outputs });
  }

  override handleToolEnd(output: unknown, runId: string, parentRunId?: string, tags?: string[]) {
    this.completeSpan({ spanId: runId, output });
  }

  override handleRetrieverEnd(documents: DocumentInterface[], runId: string, parentRunId?: string, tags?: string[]) {
    this.completeSpan({ spanId: runId, output: documents });
  }

  override handleLLMError(
    err: unknown,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    extraParams?: Record<string, unknown>
  ) {
    this.completeSpan({ spanId: runId, error: err });
  }

  override handleChainError(
    err: unknown,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    kwargs?: { inputs?: Record<string, unknown> }
  ) {
    this.completeSpan({ spanId: runId, error: err });
  }

  override handleToolError(err: unknown, runId: string, parentRunId?: string, tags?: string[]) {
    this.completeSpan({ spanId: runId, error: err });
  }

  override handleRetrieverError(err: unknown, runId: string, parentRunId?: string, tags?: string[]) {
    this.completeSpan({ spanId: runId, error: err });
  }
}

export function createTraceCollector(options: CreateTraceCollectorOptions = {}) {
  return new LangChainTraceCollector(options);
}