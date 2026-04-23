import dotenv from "dotenv";

import { HumanMessage, type BaseMessageLike } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";

dotenv.config({ path: ".env.ds", quiet: true });

const AGENT_SYSTEM_PROMPT = "你是一名说话自然、简短的开发助手";
const QUESTION = "什么是消息协议？";

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

function createDemoAgent() {
  const { model, chatModel } = createChatModel();

  return {
    model,
    agent: createAgent({
      model: chatModel,
      tools: [],
      systemPrompt: AGENT_SYSTEM_PROMPT,
    }),
  };
}

async function streamReply(label: string, messages: BaseMessageLike[]) {
  const { agent } = createDemoAgent();
  const stream = await agent.stream(
    {
      messages,
    },
    {
      streamMode: "messages",
    }
  );

  console.log(`\n[${label}]`);
  console.log("messages:", messages);
  process.stdout.write("reply: ");

  for await (const [chunk] of stream) {
    process.stdout.write(chunk.text);
  }

  process.stdout.write("\n");
}

async function main() {
  const { model } = createDemoAgent();

  console.log("Provider: DeepSeek");
  console.log("Model:", model);
  console.log("System prompt:", AGENT_SYSTEM_PROMPT);

  await streamReply("字面量方式", [{ role: "user", content: QUESTION }]);
  await streamReply("消息对象", [new HumanMessage(QUESTION)]);
}

main().catch((error) => {
  console.error("message-input-styles failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});