import path from "node:path";

import dotenv from "dotenv";

import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";

import { createTraceCollector, writeTraceFile } from "./trace/index.js";

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
  const userInput = "请用两句话介绍你自己，并说明你会如何记录这轮调用链。";

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
    systemPrompt: "你是一个简洁的中文助手。回答自然、准确、简短。",
  });

  const input = {
    messages: [{ role: "user" as const, content: userInput }],
  };
  const collector = createTraceCollector({
    traceName: "traceAgentStream",
    tags: ["trace", "minimal"],
    metadata: {
      entrypoint: "createAgent.stream",
      streamMode: "messages",
    },
    input,
  });

  const stream = await agent.stream(input, {
    callbacks: [collector],
    streamMode: "messages",
  });

  let replyText = "";

  console.log("Provider: DeepSeek");
  console.log("Model:", model);
  console.log("Trace demo: createAgent + callbacks collector + JSON file");
  process.stdout.write("Reply: ");

  for await (const [chunk] of stream) {
    replyText += chunk.text;
    process.stdout.write(chunk.text);
  }

  process.stdout.write("\n");

  const trace = collector.finalize({
    output: {
      reply: replyText,
    },
  });
  const traceFilePath = await writeTraceFile(trace, {
    outputDir: path.join(process.cwd(), "traces"),
  });

  console.log("traceId:", trace.traceId);
  console.log("Trace file:", traceFilePath);
}

main().catch(async (error) => {
  const collector = createTraceCollector({
    traceName: "traceAgentStream",
    tags: ["trace", "minimal", "startup-error"],
  });
  const trace = collector.finalize({ error });
  const traceFilePath = await writeTraceFile(trace, {
    outputDir: path.join(process.cwd(), "traces"),
  });

  console.error("trace-agent-stream failed:", error instanceof Error ? error.message : error);
  console.error("Trace file:", traceFilePath);
  process.exitCode = 1;
});