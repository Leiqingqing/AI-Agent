import dotenv from "dotenv";

import {
  RunnableLambda,
  RunnableParallel,
  RunnablePassthrough,
} from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";

dotenv.config({ path: ".env.ds", quiet: true });

const USER_INPUT = "  线上刚修完故障，我现在有点乱。  ";
const SYSTEM_PROMPT = [
  "你是一个前端陪伴助手。",
  "你会参考 emotion、urgency、riskCheck 三个预处理结果来回复用户。",
  "先回应情绪，再说明紧急程度和风险提醒，最后给一个具体下一步动作。",
].join("\n");

type ChainInput = {
  input: string;
};

type NormalizedInput = ChainInput & {
  cleanedInput: string;
};

type AnalysisResult = NormalizedInput & {
  emotion: string;
  urgency: "high" | "medium" | "low";
  riskCheck: string;
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

function detectEmotion(text: string): string {
  if (text.includes("乱") || text.includes("慌")) {
    return "overwhelmed";
  }

  if (text.includes("烦") || text.includes("崩")) {
    return "frustrated";
  }

  return "calm";
}

function detectUrgency(text: string): "high" | "medium" | "low" {
  if (text.includes("线上") || text.includes("故障") || text.includes("刚修完")) {
    return "high";
  }

  if (text.includes("有点") || text.includes("现在")) {
    return "medium";
  }

  return "low";
}

function detectRisk(text: string): string {
  if (text.includes("线上") || text.includes("故障")) {
    return "建议尽快补一条复盘记录，并确认监控与告警是否恢复正常。";
  }

  return "当前没有明显线上风险，但仍建议记录当前状态。";
}

function formatAgentContent(result: AnalysisResult): string {
  return [
    `input=${result.cleanedInput}`,
    `emotion=${result.emotion}`,
    `urgency=${result.urgency}`,
    `riskCheck=${result.riskCheck}`,
  ].join("\n");
}

async function streamAgentReply(title: string, agent: ReturnType<typeof createAgent>, result: AnalysisResult) {
  const stream = await agent.stream(
    {
      messages: [
        {
          role: "user",
          content: formatAgentContent(result),
        },
      ],
    },
    {
      streamMode: "messages",
    }
  );

  console.log(`\n=== ${title} ===`);
  console.log("Parallel result:", result);
  process.stdout.write("Reply: ");

  for await (const [chunk] of stream) {
    process.stdout.write(chunk.text);
  }

  process.stdout.write("\n");
}

async function main() {
  const { model, chatModel } = createChatModel();
  const agent = createAgent({
    model: chatModel,
    tools: [],
    systemPrompt: SYSTEM_PROMPT,
  });

  const normalizeChain = RunnableLambda.from((payload: ChainInput): NormalizedInput => ({
    ...payload,
    cleanedInput: normalizeInput(payload.input),
  }));

  const emotionChain = RunnableLambda.from((payload: NormalizedInput) => detectEmotion(payload.cleanedInput));
  const urgencyChain = RunnableLambda.from((payload: NormalizedInput) => detectUrgency(payload.cleanedInput));
  const riskCheckChain = RunnableLambda.from((payload: NormalizedInput) => detectRisk(payload.cleanedInput));

  const runnableParallelChain = normalizeChain.pipe(
    RunnableParallel.from({
      input: RunnableLambda.from((payload: NormalizedInput) => payload.input),
      cleanedInput: RunnableLambda.from((payload: NormalizedInput) => payload.cleanedInput),
      emotion: emotionChain,
      urgency: urgencyChain,
      riskCheck: riskCheckChain,
    })
  );

  const runnableAssignChain = normalizeChain.pipe(
    RunnablePassthrough.assign({
      emotion: emotionChain,
      urgency: urgencyChain,
      riskCheck: riskCheckChain,
    })
  );

  const parallelResult = await runnableParallelChain.invoke({ input: USER_INPUT });
  const assignResult = await runnableAssignChain.invoke({ input: USER_INPUT });

  console.log("Provider: DeepSeek");
  console.log("Model:", model);
  console.log("System prompt:\n", SYSTEM_PROMPT);
  console.log("Raw input:", JSON.stringify(USER_INPUT));

  await streamAgentReply("RunnableParallel", agent, parallelResult);
  await streamAgentReply("RunnablePassthrough.assign", agent, assignResult);
}

main().catch((error) => {
  console.error("runnable-parallel-comparison failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});