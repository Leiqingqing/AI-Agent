import dotenv from "dotenv";

import { createAgent } from "langchain";
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

  const agent = createAgent({
    model: chatModel,
    tools: [],
    systemPrompt: "You are a concise coding assistant.",
  });

  const result = await agent.stream({
    messages: [{ role: "user", content: "Please introduce yourself in one short sentence." }],
    
  },{
    // point: 这里的agent的流式输出有三种方式。messages,text,json，分别对应流式输出消息块，文本块，和json块。
    // 默认是messages，可以输出更丰富的消息信息，比如角色等，
    // 如果只需要文本内容，可以选择text模式，输出更简洁的文本块。如果输出是结构化数据，可以选择json模式，
    // 直接输出json块。根据实际需求选择合适的streamMode可以更高效地处理流式输出。      
    streamMode: "messages"
});

  console.log("Provider: DeepSeek");
  console.log("Model:", model);
  process.stdout.write("Reply: ");

  for await (const [chunk] of result) {
    process.stdout.write(chunk.text);
  }

  process.stdout.write("\n");
  
}

main().catch((error) => {
  console.error("agent-invoke failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});