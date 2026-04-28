import dotenv from "dotenv";

import { BaseMessage } from "@langchain/core/messages";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

dotenv.config({ path: ".env.ds", quiet: true });

const USER_INPUT = "今天一直在改 bug，越改越乱，我有点烦。";

type EmotionOutput = {
  emotion: string;
  confidence: string;
};

const emotionSchema = z
  .object({
    emotion: z
      .enum(["calm", "anxious", "sad", "angry"])
      .describe("用户当前的主要情绪，只能是 calm、anxious、sad、angry 之一。"),
    confidence: z
      .number()
      .gt(0)
      .lt(1)
      .describe("0 到 1 之间的数字，必须大于 0 且小于 1，例如 0.85。"),
  })
  .describe("单次用户输入的情绪识别结果");

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

function messageToText(message: BaseMessage): string {
  if (typeof message.content === "string") {
    if (message.content.trim()) {
      return message.content;
    }
  }

  const rawMessage = message as BaseMessage & {
    additional_kwargs?: unknown;
    tool_calls?: unknown;
    response_metadata?: unknown;
  };

  return JSON.stringify(
    {
      content: message.content,
      tool_calls: rawMessage.tool_calls,
      additional_kwargs: rawMessage.additional_kwargs,
      response_metadata: rawMessage.response_metadata,
    },
    null,
    2
  );
}

async function runJsonOutputParser(chatModel: ChatOpenAI) {
  const parser = new JsonOutputParser<EmotionOutput>();
  const systemPrompt = [
    "你负责做情绪识别。",
    "只返回 JSON，不要补充解释。",
    parser.getFormatInstructions(),
  ].join("\n");

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", systemPrompt],
    ["user", "{input}"],
  ]);

  const messageChain = prompt.pipe(chatModel);
  const parseChain = prompt.pipe(chatModel).pipe(parser);

  const rawMessage = await messageChain.invoke({ input: USER_INPUT });
  const parsedOutput = await parseChain.invoke({ input: USER_INPUT });

  return {
    systemPrompt,
    rawMessage: rawMessage.text,
    parsedOutput,
  };
}

async function runSchemaStructuredOutput(chatModel: ChatOpenAI) {
  const systemPrompt = [
    "你负责做情绪识别。",
    "根据 schema 返回结构化结果。",
  ].join("\n");

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", systemPrompt],
    ["user", "{input}"],
  ]);
// 2. withStructuredOutput
//    - 在调用模型之前就把 schema 交给模型层
//    - 模型按这个结构协议返回结果，这里通过 function calling 承载
//    - LangChain 再把返回值解析成对象，并按 schema 做校验
//    - 所以它不只是“更早格式化”，而是“生成阶段就带着约束”
// 简单说：
// JsonOutputParser = 先生成文本，再解析
// withStructuredOutput = 先声明结构，再生成并校验
  const structuredModel = chatModel.withStructuredOutput(emotionSchema, {
    name: "emotion_result",
    method: "functionCalling",
    strict: true,
    includeRaw: true,
  });

  const chain = prompt.pipe(structuredModel);
  const result = await chain.invoke({ input: USER_INPUT });

  return {
    systemPrompt,
    rawMessage: messageToText(result.raw),
    parsedOutput: result.parsed,
  };
}

async function main() {
  const { chatModel } = createChatModel();
  const parserResult = await runJsonOutputParser(chatModel);
  const schemaResult = await runSchemaStructuredOutput(chatModel);


  console.log("\n=== JsonOutputParser ===");
  console.log("Parsed output:", parserResult.parsedOutput);
  console.log("Raw message:", parserResult.rawMessage);

  console.log("\n=== Schema structured output ===");
  console.log("System prompt:\n", schemaResult.systemPrompt);
  console.log("Parsed output:", schemaResult.parsedOutput);

 }

main().catch((error) => {
  console.error("structured-output-comparison failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});