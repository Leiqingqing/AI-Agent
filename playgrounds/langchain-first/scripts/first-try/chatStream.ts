import dotenv from "dotenv";

import { ChatOpenAI } from "@langchain/openai";

dotenv.config({ path: ".env.ds", quiet: true });

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

  const stream = await chatModel.stream([
      { role: "system", content: "You are a concise coding assistant." },
      { role: "user", content: "Please introduce yourself in one short sentence." }
  ]);

  console.log("Provider: DeepSeek");
  console.log("Model:", model);
  process.stdout.write("Reply: ");

  for await (const chunk of stream) {
    process.stdout.write(chunk.text);
  }

  process.stdout.write("\n");
}

main().catch((error) => {
  console.error("first-stream failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
