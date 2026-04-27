import dotenv from "dotenv";

import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import {
  ChatPromptTemplate,
  FewShotChatMessagePromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";

dotenv.config({ path: ".env.ds", quiet: true });

const SYSTEM_PROMPT = "你是一名温和、克制、说话自然的陪伴助手。";

const userProfile = {
  name: "春暖花开",
  nickname: "花花",
  scene: "在放学的路上",
};

const currentInput = {
  input: "我看到了一个卖烤肠的车子，好香",
};

const examples = [
  {
    input: "我今天考试没发挥好，有点难受。",
    output: "这一下子确实会让人有点失落，先别太苛责自己。你可以先回想是哪几类题最卡住，晚一点只补那一小部分就好。",
  },
  {
    input: "我和朋友闹了点别扭，现在不太想说话。",
    output: "闹别扭的时候心里堵一下很正常，先让自己缓一缓。等情绪松一点，再挑一句最想说的话发给对方就够了。",
  },
  {
    input: "我作业还没写完，但已经有点犯困了。",
    output: "你现在应该已经挺累了，硬撑反而更难写进去。可以先定个十分钟的小目标，写完最急的那部分再休息。",
  },
];

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
    return { role: "user", content: message.text };
  }

  if (message instanceof AIMessage) {
    return { role: "assistant", content: message.text };
  }

  const roleMap: Record<string, string> = {
    human: "user",
    ai: "assistant",
  };

  const rawRole = message.getType();

  return {
    role: roleMap[rawRole] ?? rawRole,
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

  const examplePrompt = ChatPromptTemplate.fromMessages([
    ["user", "{input}"],
    ["assistant", "{output}"],
  ]);

  const fewShotPrompt = new FewShotChatMessagePromptTemplate({
    examples,
    examplePrompt,
    inputVariables: [],
  });

  const profilePrompt = ChatPromptTemplate.fromMessages([
    [
      "user",
      [
        "姓名：{name}",
        "昵称：{nickname}",
        "场景：{scene}",
      ].join("\n"),
    ],
  ]);

  const currentInputPrompt = ChatPromptTemplate.fromMessages([["user", "{input}"]]);

  const singleTurnPrompt = ChatPromptTemplate.fromMessages([
    profilePrompt,
    fewShotPrompt as any,
    currentInputPrompt,
  ]);

  const history = [
    new HumanMessage("今天走在路上有点累。"),
    new AIMessage("你今天应该消耗了不少力气，辛苦了。先慢一点走，也让自己缓一缓。"),
  ];

  const multiTurnPrompt = ChatPromptTemplate.fromMessages([
    profilePrompt,
    fewShotPrompt as any,
    new MessagesPlaceholder("history"),
    currentInputPrompt,
  ]);

  const singleTurnMessages = await singleTurnPrompt.formatMessages({
    ...userProfile,
    input: currentInput.input,
  });

  const multiTurnMessages = await multiTurnPrompt.formatMessages({
    ...userProfile,
    history,
    input: currentInput.input,
  });

  const formattedExamples = await Promise.all(examples.map((example) => examplePrompt.formatMessages(example)));

  console.log("Provider: DeepSeek");
  console.log("Model:", model);
  console.log("Agent systemPrompt:", SYSTEM_PROMPT);

  printSection("1. 三组 few-shot examples");
  console.dir(examples, { depth: null });

  printSection("2. examplesPrompt 模板");
  console.log("结构: [user => {input}], [assistant => {output}]");
  console.dir(formattedExamples.map((item) => item.map(toDisplayMessage)), { depth: null });

  printSection("3. 单轮对话中的 message 变化");
  console.dir(singleTurnMessages.map(toDisplayMessage), { depth: null });

  printSection("4. 多轮对话中的 message 变化");
  console.dir(multiTurnMessages.map(toDisplayMessage), { depth: null });

  printSection("5. 对比说明");
  console.log("单轮: 用户资料 -> fewShotPrompt -> 当前用户消息");
  console.log("多轮: 用户资料 -> fewShotPrompt -> MessagesPlaceholder(history) -> 当前用户消息");

  await streamAgentReply("6. 单轮对话实例", singleTurnMessages);
  await streamAgentReply("7. 多轮对话实例", multiTurnMessages);
}

main().catch((error) => {
  console.error("few-shot-walkthrough failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});