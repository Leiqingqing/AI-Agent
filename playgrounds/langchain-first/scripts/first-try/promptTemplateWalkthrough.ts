import dotenv from "dotenv";

import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";

dotenv.config({ path: ".env.ds", quiet: true });

const SYSTEM_PROMPT = "你是一名温和、克制、说话自然的陪伴助手。";

const userProfile = {
  name: "春暖花开",
  nickname: "花花",
  scene: "在放学的路上",
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

function createDemoAgent() {
  const { model, chatModel } = createChatModel();

  return {
    model,
    agent: createAgent({
      model: chatModel,
      tools: [],
      systemPrompt: SYSTEM_PROMPT,
    }),
  };
}

function toDisplayMessage(message: BaseMessage) {
  if (message instanceof HumanMessage) {
    return { role: "human", content: message.text };
  }

  if (message instanceof AIMessage) {
    return { role: "ai", content: message.text };
  }

  return {
    role: message.getType(),
    content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
  };
}

function printSection(title: string) {
  console.log(`\n=== ${title} ===`);
}

async function streamAgentReply(title: string, messages: BaseMessage[]) {
  const { agent } = createDemoAgent();
  const stream = await agent.stream(
    {
      messages,
    },
    {
      streamMode: "messages",
    }
  );

  printSection(title);
  process.stdout.write("Reply: ");

  for await (const [chunk] of stream) {
    process.stdout.write(chunk.text);
  }

  process.stdout.write("\n");
}

async function main() {
  const { model } = createDemoAgent();

  const profilePrompt = ChatPromptTemplate.fromMessages([
    [
      "human",
      [
        "姓名：{name}",
        "昵称：{nickname}",
        "场景：{scene}",
      ].join("\n"),
    ],
  ]);

  const organizedMessages = await profilePrompt.formatMessages(userProfile);

  const conversationPrompt = ChatPromptTemplate.fromMessages([
    [
      "human",
      [
        "姓名：{name}",
        "昵称：{nickname}",
        "场景：{scene}",
      ].join("\n"),
    ],
    new MessagesPlaceholder("history"),
    ["human", "我看到了一个卖烤肠的车子，好香"],
  ]);

  const history = [
    new HumanMessage("我今天有点累，但风吹着很舒服。"),
    new AIMessage("听起来有点疲惫，不过路上的风也像是在悄悄安慰你。"),
  ];

  const conversationMessages = await conversationPrompt.formatMessages({
    ...userProfile,
    history,
  });

  console.log("Provider: DeepSeek");
  console.log("Model:", model);
  console.log("Agent systemPrompt:", SYSTEM_PROMPT);

  printSection("1. Prompt Template 如何生成动态消息");
  console.log("template input:", userProfile);
  console.log("organized messages:");
  console.dir(organizedMessages.map(toDisplayMessage), { depth: null });

  printSection("2. 如何组织消息");
  console.log("Prompt 结构: 背景信息消息 -> MessagesPlaceholder(history) -> 当前用户消息");

  printSection("3. 整理好的多轮消息长什么样");
  console.dir(conversationMessages.map(toDisplayMessage), { depth: null });

  await streamAgentReply("4. 用整理好的单轮消息交给 agent", organizedMessages);
  await streamAgentReply("5. 多轮对话里使用 MessagesPlaceholder", conversationMessages);
}

main().catch((error) => {
  console.error(
    "prompt-template-walkthrough failed:",
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});