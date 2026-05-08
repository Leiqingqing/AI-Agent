# Trace JSON Design

这份设计对应“一轮用户发言生成一份 trace JSON”。

## 1. 顶层原则

- 一轮对话使用 `traceId` 标识。
- 不再额外区分 `conversationId` 和 `turnId`，统一收敛到 `traceId`。
- `spanId` 和 `spanParentId` 表示调用链树关系。
- trace 只保留关键业务 span，不保留 event 明细。
- trace 默认只保留统一的 `text` 视图，不再默认保存完整 `input` / `output` 原始对象。
- `timing` 只保留开始时间和执行时长，避免时间字段过多。
- `name` 作为节点名称主字段，不再为 event/span 额外保存太多描述性字段。
- `status` 统一收敛为 `success`、`failure`、`degraded`。

## 2. 顶层结构

```json
{
  "schemaVersion": "trace.turn.v1",
  "traceId": "5f0c6f8d-b4f0-4f4a-a2b2-9cdbbf2e01f1",
  "traceName": "support-chat-turn",
  "status": "success",
  "tags": ["demo", "memory"],
  "metadata": {
    "provider": "deepseek",
    "entrypoint": "RunnableWithMessageHistory"
  },
  "text": {
    "input": "你还记得我刚才在处理什么吗？",
    "output": "你刚才在排查缓存雪崩。"
  },
  "timing": {
    "startedAt": "2026-05-08T08:00:00.000Z",
    "startedAtMs": 1778227200000,
    "durationMs": 1248,
  },
  "rootSpanIds": ["run_root_chain"],
  "spans": []
}
```

## 3. Span 结构

```json
{
  "spanId": "run_chat_model_01",
  "spanParentId": "run_prompt_01",
  "name": "ChatOpenAI",
  "status": "success",
  "timing": {
    "startedAt": "2026-05-08T08:00:00.100Z",
    "startedAtMs": 1778227200100,
    "durationMs": 1000
  },
  "text": {
    "input": "你是一个短期记忆演示助手。\n你还记得我刚才在处理什么吗？",
    "output": "你刚才在排查缓存雪崩。"
  }
}
```

## 4. 第一版字段取舍

- 默认把输入输出收敛成 `text.input` 和 `text.output`，优先保证可读性和文件体积。
- 如果后面确实需要原始 payload，再单独增加 verbose / raw 模式，不混进默认 trace。
- 默认不记录 event、token、stream chunk，只保留业务 span。
- 不单独生成嵌套 children 树，使用 `spanId + spanParentId + rootSpanIds` 重建业务调用树。
- 会过滤 `LangGraph`、`__start__`、UUID 中转节点这类运行时内部节点。
- 如果对象无法直接 JSON 化，会转成可序列化结构，例如 `Error`、`Map`、`Set`、`Date`、循环引用标记等。
- `TraceSpanRecord` 刻意保持轻量，只保留节点识别、执行结果、时间、文本视图和错误信息。
- trace 顶层唯一业务标识就是 `traceId`，写盘文件名也默认使用 `traceId`。

## 5. 当前工具文件

- `types.ts`: 定义 trace JSON schema。
- `serializer.ts`: 把 LangChain 运行时对象转成可写入 JSON 的结构。
- `traceCollector.ts`: 基于 `BaseCallbackHandler` 采集业务 span、input/output、timing。
- `writeTraceFile.ts`: 把单轮 trace 写入磁盘。

## 6. 目前实现边界

- 这一版优先使用 callback handler，因为它稳定暴露 `runId` 和 `parentRunId`，能直接生成 `spanParentId`。
- `streamEvents` 适合做后续增强，但当前事件类型定义没有稳定暴露 `parentRunId`，不适合直接拿来做主链路树。
- Prompt 运行在 LangChain 回调里通常会以 `chain` 或 `prompt` 类型出现，具体取决于实际 runnable 触发的 `runType`。