import dotenv from "dotenv";

import { JsonOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";

dotenv.config({ path: ".env.ds", quiet: true });

const USER_INPUT = "今天一直在改 bug，越改越乱，我有点烦。";

type EmotionOutput = {
  emotion: string;
  confidence: string;
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

async function main() {
  const parser = new JsonOutputParser<EmotionOutput>();
  const systemPrompt = [
    "你负责做情绪识别。",
    "只返回 JSON，不要补充解释。",
    parser.getFormatInstructions(),
  ].join("\n");

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", systemPrompt],
    [
      "user",
      [
        "{input}",
      ].join("\n"),
    ],
  ]);

  const { model, chatModel } = createChatModel();

  // JsonOutputParser 的核心特点是：
  // 1. 先通过 prompt 告诉模型“请返回 JSON”
  // 2. 模型先生成一条普通文本消息
  // 3. 再由 parser 在模型输出之后解析这段文本
  // 所以它更像“先生成，再做后处理解析”。
  const messageChain = prompt.pipe(chatModel);
  const parseChain = prompt.pipe(chatModel).pipe(parser);

  const rawMessage = await messageChain.invoke({ input: USER_INPUT });
  const parsedOutput = await parseChain.invoke({ input: USER_INPUT });

  console.log("Provider: DeepSeek");
  console.log("Model:", model);
  console.log("User input:", USER_INPUT);
  console.log("System prompt:\n", systemPrompt);
  console.log("Parsed output:", parsedOutput);
  console.log("Raw message:", rawMessage.text);
}

main().catch((error) => {
  console.error("json-output-parser-emotion failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});