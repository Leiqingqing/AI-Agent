import dotenv from "dotenv";

import { RunnableLambda, RunnablePassthrough } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";

dotenv.config({ path: ".env.ds", quiet: true });

const USER_INPUT = "  线上刚修完故障，我现在有点乱。  ";
const SYSTEM_PROMPT = [
  "你是一个前端陪伴助手。",
  "如果 priority=high，先帮用户稳住情绪，再给一个动作建议。",
  "如果 priority=normal，就正常交流，不要过度放大情绪。",
].join("\n");

type ChainInput = {
  input: string;
};

type PreprocessedInput = ChainInput & {
  cleanedInput: string;
  priority: "high" | "normal";
};

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

function normalizeInput(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function getPriority(text: string): "high" | "normal" {
  const highPriorityKeywords = ["故障", "线上", "乱", "崩", "烦", "急", "慌"];

  return highPriorityKeywords.some((keyword) => text.includes(keyword)) ? "high" : "normal";
}

async function main() {
  const { model, chatModel } = createChatModel();
  const agent = createAgent({
    model: chatModel,
    tools: [],
    systemPrompt: SYSTEM_PROMPT,
  });

  const preprocessChain = RunnablePassthrough.assign({
    cleanedInput: RunnableLambda.from((payload: ChainInput) => normalizeInput(payload.input)),
    priority: RunnableLambda.from((payload: ChainInput) => getPriority(normalizeInput(payload.input))),
  });

  const toAgentPayload = RunnableLambda.from((payload: PreprocessedInput) => ({
    messages: [
      {
        role: "user" as const,
        content: [
          `priority=${payload.priority}`,
          `input=${payload.cleanedInput}`,
        ].join("\n"),
      },
    ],
  }));

  const chain = preprocessChain.pipe(toAgentPayload);
  const preprocessed = await preprocessChain.invoke({ input: USER_INPUT });
  const agentPayload = await chain.invoke({ input: USER_INPUT });
  const stream = await agent.stream(agentPayload, {
    streamMode: "messages",
  });

  console.log("Provider: DeepSeek");
  console.log("Model:", model);
  console.log("System prompt:\n", SYSTEM_PROMPT);
  console.log("Raw input:", JSON.stringify(USER_INPUT));
  console.log("Cleaned input:", preprocessed.cleanedInput);
  console.log("Priority:", preprocessed.priority);
  console.log("Agent payload:", agentPayload.messages[0].content);

  process.stdout.write("Reply: ");

  for await (const [chunk] of stream) {
    process.stdout.write(chunk.text);
  }

  process.stdout.write("\n");
}

main().catch((error) => {
  console.error("runnable-priority-agent failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});