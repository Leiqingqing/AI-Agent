import dotenv from "dotenv";

import { ChatOpenAI } from "@langchain/openai";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { createAgent, summarizationMiddleware } from "langchain";

dotenv.config({ path: ".env.ds", quiet: true });

const AGENT_SYSTEM_PROMPT = [
  "你是一个短期记忆演示助手。",
  "你的短期记忆来自当前 thread_id 对应的 checkpoints。",
  "只根据当前 thread_id 的历史消息回答。",
  "如果历史里出现压缩后的摘要消息，把它当作内部上下文使用，不要逐字复述摘要前缀。",
  "如果这个 thread 里没有相关信息，就直接说不知道。",
  "回答保持简短、自然。",
].join("\n");

const SUMMARY_PROMPT = [
  "请把下面的历史对话压缩成一段很短的中文记忆摘要。",
  "优先保留这些事实：用户姓名、正在处理的任务、明确提到的计划、已经确认过的结论。",
  "不要丢失人名、时间段、任务目标。",
  "如果某条信息不确定，就不要编造。",
  "只输出摘要正文，不要加标题，不要加解释。",
  "消息历史如下：",
  "{messages}",
].join("\n");

const CONVERSATION_TURNS = [
  {
    title: "thread A / turn 1",
    threadId: "incident-2026-05-06-morning",
    input: "我叫小李，今天一直在排查缓存雪崩。",
  },
  {
    title: "thread A / turn 2",
    threadId: "incident-2026-05-06-morning",
    input: "你还记得我叫什么，以及我刚才在处理什么吗？",
  },
  {
    title: "thread B / turn 1",
    threadId: "after-work-2026-05-06-evening",
    input: "你还记得我叫什么吗？如果不知道就直接说不知道。",
  },
  {
    title: "thread B / turn 2",
    threadId: "after-work-2026-05-06-evening",
    input: "那我现在告诉你，我叫阿青，刚下班准备去吃一碗热面。",
  },
  {
    title: "thread B / turn 3",
    threadId: "after-work-2026-05-06-evening",
    input: "你记得我刚才说我叫什么、准备去做什么吗？",
  },
] as const;

type ConversationTurn = (typeof CONVERSATION_TURNS)[number];

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function createChatModel() {
  const apiKey = getRequiredEnv("DEEPSEEK_API_KEY");
  const baseURL = getRequiredEnv("DEEPSEEK_BASE_URL");
  const model = getRequiredEnv("DEEPSEEK_MODEL");

  return {
    model,
    chatModel: new ChatOpenAI({
      apiKey,
      model,
      temperature: 0,
      configuration: {
        baseURL,
      },
    }),
  };
}

async function printCheckpointStats(checkpointer: MemorySaver, threadId: string) {
  const checkpointIds: string[] = [];
  const latestTuple = await checkpointer.getTuple({
    configurable: {
      thread_id: threadId,
    },
  });
  const storedMessages = Array.isArray(latestTuple?.checkpoint.channel_values.messages)
    ? latestTuple.checkpoint.channel_values.messages
    : [];
  const hasSummaryMessage = storedMessages.some((message) => {
    if (!message || typeof message !== "object") {
      return false;
    }

    if (!("additional_kwargs" in message) || !message.additional_kwargs || typeof message.additional_kwargs !== "object") {
      return false;
    }

    return "lc_source" in message.additional_kwargs && message.additional_kwargs.lc_source === "summarization";
  });

  for await (const item of checkpointer.list({
    configurable: {
      thread_id: threadId,
    },
  })) {
    checkpointIds.push(item.checkpoint.id);
  }

  console.log("Saved checkpoints in this thread:", checkpointIds.length);

  if (checkpointIds.length > 0) {
    console.log("Latest checkpoint id:", checkpointIds[0]);
  }

  console.log("Stored messages in latest checkpoint:", storedMessages.length);
  console.log("Summary message present:", hasSummaryMessage);
}

async function streamTurnReply(
  agent: ReturnType<typeof createAgent>,
  checkpointer: MemorySaver,
  turn: ConversationTurn
) {
  const stream = await agent.stream(
    {
      messages: [{ role: "user", content: turn.input }],
    },
    {
      configurable: {
        thread_id: turn.threadId,
      },
      streamMode: "messages",
    }
  );

  console.log("\n----------------------------------------");
  console.log("Case:", turn.title);
  console.log("thread_id:", turn.threadId);
  console.log("Input:", turn.input);
  process.stdout.write("Reply: ");

  for await (const [chunk] of stream) {
    process.stdout.write(chunk.text);
  }

  process.stdout.write("\n");
  await printCheckpointStats(checkpointer, turn.threadId);
}

async function main() {
  const { model, chatModel } = createChatModel();
  const checkpointer = new MemorySaver();
  const agent = createAgent({
    model: chatModel,
    tools: [],
    systemPrompt: AGENT_SYSTEM_PROMPT,
    checkpointer,
    middleware: [
      summarizationMiddleware({
        model: chatModel,
        trigger: { messages: 4 },// Trigger summarization when there are 4 messages in the checkpoint history
        keep: { messages: 2 }, // Keep the last 2 messages after summarization
        summaryPrefix: "",
        summaryPrompt: SUMMARY_PROMPT,
      }),
    ],
  });

  console.log("Provider: DeepSeek");
  console.log("Model:", model);
  console.log("Memory demo: createAgent + MemorySaver checkpoints + configurable.thread_id");
  console.log("Compression: summarizationMiddleware(trigger: { messages: 4 }, keep: { messages: 2 })");
  console.log("Different thread_id values represent different short-term conversation windows.\n");

  for (const turn of CONVERSATION_TURNS) {
    await streamTurnReply(agent, checkpointer, turn);
  }
}

main().catch((error) => {
  console.error("thread-checkpoint-memory failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});