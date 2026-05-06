import dotenv from "dotenv";

import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";

dotenv.config({ path: ".env.ds", quiet: true });

const AGENT_SYSTEM_PROMPT = [
  "你是一个短期记忆演示助手。",
  "你只根据当前 sessionId 对应的对话历史回答问题。",
  "如果当前 session 里没有相关信息，就直接说不知道，不要补充猜测。",
  "回答保持简短、自然。",
].join("\n");

const CONVERSATION_TURNS = [
  {
    title: "session A / turn 1",
    sessionId: "incident-2026-05-06-morning",
    input: "我叫小李，今天一直在排查缓存雪崩。",
  },
  {
    title: "session A / turn 2",
    sessionId: "incident-2026-05-06-morning",
    input: "你还记得我叫什么，以及我刚才在处理什么吗？",
  },
  {
    title: "session B / turn 1",
    sessionId: "after-work-2026-05-06-evening",
    input: "这是一个新的对话时段。你还记得我叫什么吗？如果不知道就直接说不知道。",
  },
  {
    title: "session B / turn 2",
    sessionId: "after-work-2026-05-06-evening",
    input: "那我现在告诉你，我叫阿青，刚下班准备去吃一碗热面。",
  },
  {
    title: "session B / turn 3",
    sessionId: "after-work-2026-05-06-evening",
    input: "你记得我刚才说我叫什么、准备去做什么吗？",
  },
] as const;

type ConversationTurn = (typeof CONVERSATION_TURNS)[number];

const historyStore = new Map<string, InMemoryChatMessageHistory>();

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

function getSessionHistory(sessionId: string): InMemoryChatMessageHistory {
  const existing = historyStore.get(sessionId);

  if (existing) {
    return existing;
  }

  const created = new InMemoryChatMessageHistory();
  historyStore.set(sessionId, created);
  return created;
}

function createMemoryAgent(chatModel: ChatOpenAI) {
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", AGENT_SYSTEM_PROMPT],
    new MessagesPlaceholder("history"),
    ["user", "{input}"],
  ]);
  const chain = prompt.pipe(chatModel);

  return new RunnableWithMessageHistory({
    runnable: chain,
    getMessageHistory: (sessionId) => getSessionHistory(String(sessionId)),
    inputMessagesKey: "input",
    historyMessagesKey: "history",
  });
}

function readChunkText(chunk: unknown): string {
  const value = Array.isArray(chunk) ? chunk[0] : chunk;

  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  if ("text" in value && typeof value.text === "string") {
    return value.text;
  }

  if ("content" in value) {
    const content = value.content;

    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }

          if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
            return part.text;
          }

          return "";
        })
        .join("");
    }
  }

  return "";
}

async function printSessionHistoryStats(sessionId: string) {
  const messages = await getSessionHistory(sessionId).getMessages();
  console.log("History messages in this session:", messages.length);
}

async function streamTurnReply(memoryAgent: ReturnType<typeof createMemoryAgent>, turn: ConversationTurn) {
  const stream = await memoryAgent.stream(
    { input: turn.input },
    {
      configurable: {
        sessionId: turn.sessionId,
      },
    }
  );

  console.log("\n----------------------------------------");
  console.log("Case:", turn.title);
  console.log("sessionId:", turn.sessionId);
  console.log("Input:", turn.input);
  process.stdout.write("Reply: ");

  for await (const chunk of stream) {
    process.stdout.write(readChunkText(chunk));
  }

  process.stdout.write("\n");
  await printSessionHistoryStats(turn.sessionId);
}

async function main() {
  const { model, chatModel } = createChatModel();
  const memoryAgent = createMemoryAgent(chatModel);

  console.log("Provider: DeepSeek");
  console.log("Model:", model);
  console.log("Memory demo: RunnableWithMessageHistory + configurable.sessionId");
  console.log("Session IDs represent different short-term conversation windows.\n");

  for (const turn of CONVERSATION_TURNS) {
    await streamTurnReply(memoryAgent, turn);
  }
}

main().catch((error) => {
  console.error("runnable-message-history failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});