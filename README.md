# AI-Agent

这个仓库用于学习和整理 Agent 开发过程。

当前目标：
- 写一个最小化的 agent 或模型调用示例
- 逐步理解单轮调用、流式输出、Prompt、记忆、工具调用等能力
- 将可运行 demo 和总结文档分开管理，方便持续扩展

## 目录用途

```text
AI-Agent/
├─ docs/
│  └─ langchain-first/
│     └─ ...总结文档
├─ playgrounds/
│  └─ langchain-first/
│     └─ ...可运行 demo
└─ README.md
```

目录职责：
- `docs/`: 放学习总结、阶段记录、概念说明、踩坑记录
- `playgrounds/`: 放可以直接运行的 demo、实验代码、最小验证示例

对应关系：
- `playgrounds` 下每个主题目录，应该在 `docs` 下有一个同名目录
- `playgrounds/<topic>` 负责“代码怎么跑”
- `docs/<topic>` 负责“这组 demo 学到了什么”

例如：
- `playgrounds/langchain-first`: 放 LangChain 第一阶段的 demo
- `docs/langchain-first`: 放这组 demo 的总结文档

## 命名规则

为了后续持续扩展，统一使用以下规则：

- 目录名使用主题化命名，优先表达学习阶段或主题，例如 `langchain-first`
- 文件名使用小驼峰命名，例如 `firstTry.ts`、`streamExample.ts`、`summaryNote.md`
- 文件名不要出现具体模型名字，例如不要用 `deepseekChatDemo.ts`
- 文件名不要直接写 `demo` 这类过于泛化的词，优先表达文件职责

## 当前学习方式

当前按下面的顺序推进：

1. 最小模型调用
2. 流式输出
3. Prompt 组织
4. 对话 history
5. Agent
6. Tool calling

## 补充说明

流式返回常见有三种形态：
- `message`: 适合聊天消息流
- `text`: 适合控制台或日志输出
- `json`: 适合结构化数据处理


