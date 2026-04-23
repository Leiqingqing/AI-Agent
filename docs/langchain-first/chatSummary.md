# LangChain First 

这次 playground 里的内容属于 LangChain 基础调用阶段，目标是先打通模型连接，再理解普通调用和流式调用的区别。

### 1. 普通调用 demo

文件：`playgrounds/langchain-first/scripts/first-try/chatInvoke.ts`

作用：
- 使用 `dotenv` 从 `.env.ds` 读取 DeepSeek 配置
- 初始化 `ChatOpenAI`
- 使用 `invoke()` 发送一轮消息
- 一次性输出完整结果

核心流程：
1. 读取环境变量 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`
2. 创建 `ChatOpenAI` 实例
3. 传入 `SystemMessage` 和 `HumanMessage`
4. 调用 `chatModel.invoke()`
5. 打印模型返回文本

运行命令：

```powershell
npm run chat:invoke
```

### 2. 流式调用 demo

文件：`playgrounds/langchain-first/scripts/first-try/chatStream.ts`

作用：
- 使用与普通调用 demo 相同的模型配置
- 使用 `stream()` 获取流式输出
- 边接收边写入控制台

核心流程：
1. 读取相同的 DeepSeek 环境变量
2. 创建 `ChatOpenAI` 实例
3. 调用 `chatModel.stream()`
4. 使用 `for await ... of` 逐块读取返回内容
5. 将每个 `chunk.text` 写入 `stdout`

运行命令：

```powershell
npm run chat:stream
```

适合场景：
- 聊天窗口逐字输出
- CLI 实时反馈
- 观察模型生成过程



### `invoke()` 和 `stream()` 的区别

`invoke()`：
- 一次性返回完整结果
- 代码更短
- 适合最小验证和脚本调用

`stream()`：
- 分块返回结果
- 更接近真实聊天产品的交互体验
- 适合做 Agent 的消息流输出基础

### DeepSeek 可以通过 OpenAI 兼容接口接入

当前 demo 使用的是 `@langchain/openai` 的 `ChatOpenAI`，但通过传入：

- `apiKey`
- `model`
- `configuration.baseURL`

就可以接到 DeepSeek 的兼容接口上。这说明后续如果你换兼容 OpenAI 协议的模型服务，接入方式通常也类似。

