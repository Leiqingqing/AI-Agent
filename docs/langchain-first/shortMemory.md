# Short Memory

这份总结聚焦 LangChain 里短期记忆的两种常见处理方式：

- `RunnableWithMessageHistory`
- `thread_id + checkpointer`

## 1. `RunnableWithMessageHistory`

示例文件：`playgrounds/langchain-first/scripts/first-try/runnableMessageHistory.ts`

核心思路：
- 用 `RunnableWithMessageHistory` 包住一个 runnable
- 每次调用时传入 `configurable.sessionId`
- 通过 `getMessageHistory(sessionId)` 取出该 session 对应的历史消息
- 在 runnable 执行前把历史消息注入进去，执行后再把本轮输入和输出写回历史

它更像是：

`sessionId -> chat history -> 注入到 runnable -> 执行结束后回写 history`

特点：
- 适合围绕单条 runnable 或 prompt chain 管理短期记忆
- 控制点很清晰，容易理解“历史是怎么注入进去的”
- 更偏 LCEL / Runnable 风格

## 2. `thread_id + checkpointer`

示例文件：`playgrounds/langchain-first/scripts/first-try/threadCheckpointMemory.ts`

核心思路：
- 用 `createAgent()` 创建 agent
- 给 agent 传入 `checkpointer`
- 每次调用时传入 `configurable.thread_id`
- LangGraph runtime 会按 `thread_id` 自动恢复这个 thread 的最新 state，并在执行后自动保存新的 checkpoint

它更像是：

`thread_id -> 恢复 checkpoint state -> agent 运行 -> 保存新的 checkpoint`

这里保存的不只是消息，还包括完整的 agent graph state。只是这个示例里最直观的是 `messages` 被持久化了。

特点：
- 更适合 `createAgent()` / LangGraph 风格的应用
- 不需要自己手动管理消息注入和写回
- 更容易继续扩展到 tools、middleware、interrupt、resume 等能力

## 两种方式的使用场景

`RunnableWithMessageHistory` 适合：
- 你只有一条 runnable chain，需要给它补多轮对话记忆
- 你想明确控制历史消息的注入位置，比如配合 `MessagesPlaceholder("history")`
- 你当前还不需要完整 agent graph 的状态管理

`thread_id + checkpointer` 适合：
- 你已经在用 `createAgent()`
- 你希望短期记忆和 agent state 一起自动持久化
- 你后面可能继续接 tool、middleware、checkpoint resume、human-in-the-loop

可以简单理解为：

- `RunnableWithMessageHistory` 更偏“给一条 chain 补历史”
- `thread_id + checkpointer` 更偏“给整个 agent 保存和恢复状态”

## `summarizationMiddleware` 接入后的变化

当 agent 没有接 `summarizationMiddleware` 时，流程大致是：

1. 根据 `thread_id` 从 checkpointer 恢复当前 thread 的 state
2. 直接进入 agent 模型调用
3. 执行结束后把最新 state 写回 checkpoint

接入 `summarizationMiddleware` 之后，流程变成：

1. 根据 `thread_id` 恢复当前 thread 的 state
2. 先进入 `beforeModel` 阶段的 `summarizationMiddleware`
3. 中间件检查当前 `messages` 是否达到 `trigger` 条件
4. 如果没达到阈值，直接继续模型调用
5. 如果达到阈值，先把较早的历史消息压缩成一条 summary message，再保留最近几条消息
6. agent 使用“压缩后的 messages”继续本轮推理
7. 执行结束后，把压缩后的最新 state 一起写回 checkpoint

也就是说，`summarizationMiddleware` 改变的不是“记忆是否保存”，而是“模型在本轮推理前看到的历史形态”。

原来模型看到的是完整长历史；
接入后，模型看到的是：

- 压缩后的摘要消息
- 最近保留的几条消息
- 当前用户输入

这样做的价值是：
- 降低上下文长度增长速度
- 保留关键事实
- 让短期记忆更适合长对话场景