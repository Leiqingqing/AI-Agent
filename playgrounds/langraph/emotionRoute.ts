type Emotion = "positive" | "neutral" | "negative";

import dotenv from "dotenv";

import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";

dotenv.config({ path: ".env.ds", quiet: true });

const USER_INPUT = "今天开会被连续追问，整个人有点烦，也有点累。";

const emotionSchema = z.object({
  emotion: z.enum(["positive", "neutral", "negative"]),
  emotionReason: z.string(),
});

const schemaState = Annotation.Root({
  userInput: Annotation<string>,
  greeting: Annotation<string>,
  introduction: Annotation<string>,
  emotion: Annotation<Emotion>,
  emotionReason: Annotation<string>,
  emotionReply: Annotation<string>,
});

type GraphState = typeof schemaState.State;

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

async function generateText(chatModel: ChatOpenAI, systemPrompt: string, input: string): Promise<string> {
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", systemPrompt],
    ["user", "{input}"],
  ]);

  const chain = prompt.pipe(chatModel);
  const message = await chain.invoke({ input });

  return message.text.trim();
}

async function detectEmotion(chatModel: ChatOpenAI, input: string): Promise<Pick<GraphState, "emotion" | "emotionReason">> {
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      [
        "你负责识别用户这一句输入的整体情绪。",
        "只能返回结构化结果。",
        "emotion 只能是 positive、neutral、negative 之一。",
        "emotionReason 用一句简短中文说明判断依据。",
      ].join("\n"),
    ],
    ["user", "{input}"],
  ]);

  const structuredModel = chatModel.withStructuredOutput(emotionSchema, {
    name: "emotion_result",
    method: "functionCalling",
    strict: true,
  });

  const chain = prompt.pipe(structuredModel);

  return chain.invoke({ input });
}

function buildGraph(chatModel: ChatOpenAI) {
  async function greetNode(state: GraphState): Promise<Partial<GraphState>> {
    const greeting = await generateText(
      chatModel,
      [
        "你是一名温和、简洁的陪伴助手。",
        "请针对用户输入，生成一句自然的中文打招呼。",
        "只输出一句话，不要解释。",
      ].join("\n"),
      state.userInput
    );

    return { greeting };
  }

  async function introduceNode(state: GraphState): Promise<Partial<GraphState>> {
    const introduction = await generateText(
      chatModel,
      [
        "你是一名温和、简洁的陪伴助手。",
        "请用一句中文做自我介绍。",
        "这句话必须是第一人称介绍，并且必须以‘我是’开头。",
        "需要明确说明你是一个用 LangGraph 串起来、能根据情绪给出不同回应的助手。",
        "不要安抚用户，不要评价用户状态，只做自我介绍。",
        "只输出一句话，不要解释。",
      ].join("\n"),
      state.userInput
    );

    return { introduction };
  }

  async function analyzeEmotionNode(state: GraphState): Promise<Partial<GraphState>> {
    const emotionResult = await detectEmotion(chatModel, state.userInput);

    return {
      emotion: emotionResult.emotion,
      emotionReason: emotionResult.emotionReason,
    };
  }

  return new StateGraph(schemaState)
    .addNode("greet", greetNode)
    .addNode("introduce", introduceNode)
    .addNode("analyzeEmotion", analyzeEmotionNode)
    .addNode("positiveEmotionHandle", positiveEmotionHandle)
    .addNode("neutralEmotionHandle", neutralEmotionHandle)
    .addNode("negativeEmotionHandle", negativeEmotionHandle)
    .addEdge(START, "greet")
    .addEdge("greet", "introduce")
    .addEdge("introduce", "analyzeEmotion")
    .addConditionalEdges("analyzeEmotion", routeByEmotion)
    .addEdge("positiveEmotionHandle", END)
    .addEdge("neutralEmotionHandle", END)
    .addEdge("negativeEmotionHandle", END)
    .compile();
}

async function positiveEmotionHandle(): Promise<Partial<GraphState>> {
  return {
    emotionReply: "听起来你状态不错，继续保持这个节奏，有进展也可以继续和我分享。",
  };
}

async function neutralEmotionHandle(): Promise<Partial<GraphState>> {
  return {
    emotionReply: "你现在整体比较平稳，如果你愿意，我可以继续陪你把事情拆开来说。",
  };
}

async function negativeEmotionHandle(): Promise<Partial<GraphState>> {
  return {
    emotionReply: "我听到你有些烦和累，先别急着继续顶住，我们可以先把最堵的一件事拎出来。",
  };
}

function routeByEmotion(state: GraphState): "positiveEmotionHandle" | "neutralEmotionHandle" | "negativeEmotionHandle" {
  switch (state.emotion) {
    case "positive":
      return "positiveEmotionHandle";
    case "negative":
      return "negativeEmotionHandle";
    default:
      return "neutralEmotionHandle";
  }
}

async function main() {
  const { model, chatModel } = createChatModel();
  const graph = buildGraph(chatModel);

  const result = await graph.invoke({
    userInput: USER_INPUT,
  });

  console.log("Model:", model);
  console.log("User input:", result.userInput);
  console.log("Greeting:", result.greeting);
  console.log("Introduction:", result.introduction);
  console.log("Emotion:", result.emotion);
  console.log("Reason:", result.emotionReason);
  console.log("Reply:", result.emotionReply);
}

main().catch((error) => {
  console.error("langgraph-emotion-route failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});