import dotenv from "dotenv";

import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableBranch, RunnableLambda } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";

dotenv.config({ path: ".env.ds", quiet: true });

const SAMPLE_INPUTS = [
  "线上刚修完故障，我现在有点乱。",
  "这个接口一直报 500，我想先确认是不是缓存层有问题。",
  "今天下班准备去吃点热的，想放松一下。",
];
const CLASSIFIER_SYSTEM_PROMPT = [
  "判断用户消息意图，只输出以下三个类别之一：",
  "- tech",
  "- emotional",
  "- casual",
].join("\n");
const AGENT_SYSTEM_PROMPT = [
  "你是一个前端陪伴助手。",
  "你会参考 intent 和 branchContext 来回复用户。",
  "先贴着用户当前意图回应，再给一个自然、具体的下一步建议。",
].join("\n");

type ChainInput = {
  input: string;
};

type Intent = "tech" | "emotional" | "casual";

type ClassifiedInput = ChainInput & {
  intent: Intent;
};

type RoutedInput = ClassifiedInput & {
  branchContext: string;
  routeLabel: string;
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

function normalizeIntent(text: string): Intent {
  const normalized = text.trim().toLowerCase();

  if (normalized.includes("tech")) {
    return "tech";
  }

  if (normalized.includes("emotional")) {
    return "emotional";
  }

  return "casual";
}

function formatAgentMessage(payload: RoutedInput): string {
  return [
    `intent=${payload.intent}`,
    `routeLabel=${payload.routeLabel}`,
    `branchContext=${payload.branchContext}`,
    `input=${payload.input}`,
  ].join("\n");
}

async function streamAgentReply(title: string, agent: ReturnType<typeof createAgent>, payload: RoutedInput) {
  const agentPayload = {
    messages: [
      {
        role: "user" as const,
        content: formatAgentMessage(payload),
      },
    ],
  };
  const stream = await agent.stream(agentPayload, {
    streamMode: "messages",
  });

  console.log(`\n=== ${title} ===`);
  console.log("Intent:", payload.intent);
  console.log("Route:", payload.routeLabel);
  console.log("Branch context:", payload.branchContext);
  console.log("Agent payload:", agentPayload.messages[0].content);
  process.stdout.write("Reply: ");

  for await (const [chunk] of stream) {
    process.stdout.write(chunk.text);
  }

  process.stdout.write("\n");
}

function printCaseHeader(input: string) {
  console.log("\n----------------------------------------");
  console.log("Input:", input);
}

async function main() {
  const { model, chatModel } = createChatModel();
  const agent = createAgent({
    model: chatModel,
    tools: [],
    systemPrompt: AGENT_SYSTEM_PROMPT,
  });

  const classifierPrompt = ChatPromptTemplate.fromMessages([
    ["system", CLASSIFIER_SYSTEM_PROMPT],
    ["user", "{input}"],
  ]);

  const classifyIntentChain = classifierPrompt
    .pipe(chatModel)
    .pipe(RunnableLambda.from((message) => normalizeIntent(message.text)));

  const prepareInputChain = RunnableLambda.from(async (payload: ChainInput): Promise<ClassifiedInput> => ({
    ...payload,
    intent: await classifyIntentChain.invoke({ input: payload.input }),
  }));

  const techChain = RunnableLambda.from((payload: ClassifiedInput): RoutedInput => ({
    ...payload,
    routeLabel: "tech-branch",
    branchContext: "这是一个技术语境消息，优先识别线上故障、排查、复盘、监控恢复等信息。",
  }));

  const emotionalChain = RunnableLambda.from((payload: ClassifiedInput): RoutedInput => ({
    ...payload,
    routeLabel: "emotional-branch",
    branchContext: "这是一个情绪支持语境消息，优先稳住情绪，再给一个很小的动作建议。",
  }));

  const casualChain = RunnableLambda.from((payload: ClassifiedInput): RoutedInput => ({
    ...payload,
    routeLabel: "casual-branch",
    branchContext: "这是一个日常闲聊语境消息，正常自然交流即可，不需要过度技术化或情绪化。",
  }));

  const branchRouter = RunnableBranch.from<ClassifiedInput, RoutedInput>([
    [(payload) => payload.intent === "tech", techChain],
    [(payload) => payload.intent === "emotional", emotionalChain],
    casualChain,
  ]);

  const lambdaRouter = RunnableLambda.from(async (payload: ClassifiedInput): Promise<RoutedInput> => {
    if (payload.intent === "tech") {
      return techChain.invoke(payload);
    }

    if (payload.intent === "emotional") {
      return emotionalChain.invoke(payload);
    }

    return casualChain.invoke(payload);
  });

  const branchChain = prepareInputChain.pipe(branchRouter);
  const lambdaChain = prepareInputChain.pipe(lambdaRouter);

  console.log("Provider: DeepSeek");
  console.log("Model:", model);
  console.log("Classifier system prompt:\n", CLASSIFIER_SYSTEM_PROMPT);
  console.log("Agent system prompt:\n", AGENT_SYSTEM_PROMPT);

  for (const input of SAMPLE_INPUTS) {
    printCaseHeader(input);

    const classified = await prepareInputChain.invoke({ input });
    const branchResult = await branchChain.invoke({ input });
    const lambdaResult = await lambdaChain.invoke({ input });

    console.log("Classified intent:", classified.intent);

    await streamAgentReply("RunnableBranch", agent, branchResult);
    await streamAgentReply("RunnableLambda", agent, lambdaResult);
  }
}

// RunnableBranch 适合条件清晰、分支固定、每个分支本身就是独立 Chain 的场景。
// RunnableLambda 更适合轻量动态路由，例如先算出一个 key，再手动选择下一个 runnable 或组装调用参数。
// 如果你要显式表达“条件 -> 分支链”的结构，用 RunnableBranch 更直观；
// 如果路由逻辑更像一小段程序控制流，用 RunnableLambda 会更灵活。

main().catch((error) => {
  console.error("runnable-branch-routing failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});