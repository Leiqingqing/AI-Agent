import dotenv from "dotenv";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";

dotenv.config({ path: ".env.ds" });

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function main() {
  const apiKey = getRequiredEnv("DEEPSEEK_API_KEY");
  const baseURL = getRequiredEnv("DEEPSEEK_BASE_URL");
  const model = getRequiredEnv("DEEPSEEK_MODEL");

  const chatModel = new ChatOpenAI({
    apiKey,
    model,
    temperature: 0,
    configuration: {
      baseURL,
    },
  });

  const response = await chatModel.invoke([
    new SystemMessage("You are a concise coding assistant."),
    new HumanMessage("Please introduce yourself in one short sentence."),
  ]);

  console.log("Provider: DeepSeek");
  console.log("Model:", model);
  console.log("Reply:", response.text);
}

main().catch((error) => {
  console.error("first-try failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
