import dotenv from "dotenv";

import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { END, MessagesValue, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { z } from "zod";

dotenv.config({ path: ".env.ds", quiet: true });

const BASE_SYSTEM_PROMPT = [
  "你是一名温和、克制的中文助手。",
  "你需要记住当前 thread_id 下已经发生过的对话。",
  "先接住用户情绪，再给出清楚可执行的建议。",
  "如果需要多个动作，按顺序处理；同一轮最多调用一个工具。",
].join("\n");

const MAX_TOOL_STEPS = 3;
const THREAD_ID = "emotion-stream-learning-thread";
const CONVERSATION_TURNS = [
  {
    label: "turn 1 / updates",
    streamMode: "updates",
    input: "我今天开会被连续追问，有点烦。先帮我看看上海今天的天气。",
  },
  {
    label: "turn 2 / values",
    streamMode: "values",
    input: "你还记得我刚才为什么烦吗？顺便看看我今天剩下的日程。",
  },
  {
    label: "turn 3 / messages",
    streamMode: "messages",
    input: "基于你记得的上下文，给我一个简短的下半天安排建议。",
  },
] as const;

const emotionSchema = z.object({
  emotion: z.enum(["positive", "neutral", "negative"]),
  emotionReason: z.string(),
});

const workflowState = new StateSchema({
  userInput: z.string(),
  messages: MessagesValue,
  emotion: z.enum(["positive", "neutral", "negative"]).default("neutral"),
  emotionReason: z.string().default(""),
  replyStyle: z.string().default(""),
  toolStepCount: z.number().default(0),
  weatherResult: z.string().default(""),
  scheduleResult: z.string().default(""),
  finalAnswer: z.string().default(""),
});

type WorkflowState = typeof workflowState.State;
type WorkflowUpdate = typeof workflowState.Update;
type ConversationTurn = (typeof CONVERSATION_TURNS)[number];

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

function createWeatherTool() {
  return tool(
    async ({ city, day }) => {
      const forecasts: Record<string, { condition: string; temperatureC: number; advice: string }> = {
        "上海": { condition: "多云转小雨", temperatureC: 26, advice: "建议带伞，晚点外出留 20 分钟机动时间。" },
        "北京": { condition: "晴", temperatureC: 28, advice: "适合出门，注意午后防晒。" },
        "杭州": { condition: "阵雨", temperatureC: 24, advice: "最好带伞，安排上预留通勤缓冲。" },
        "深圳": { condition: "闷热有雷阵雨", temperatureC: 31, advice: "不建议久待户外，注意补水。" },
      };

      const forecast = forecasts[city] ?? forecasts["上海"];

      return JSON.stringify(
        {
          city,
          day,
          condition: forecast.condition,
          temperatureC: forecast.temperatureC,
          advice: forecast.advice,
          source: "mock-weather-service",
        },
        null,
        2
      );
    },
    {
      name: "get_weather",
      description: "查询某个城市某一天的天气。",
      schema: z.object({
        city: z.string().min(1).describe("要查询的城市。"),
        day: z.string().min(1).describe("要查询的时间，比如今天或明天。"),
      }),
    }
  );
}

function createScheduleTool() {
  return tool(
    async ({ day }) => {
      const schedules: Record<string, Array<{ time: string; title: string }>> = {
        "今天": [
          { time: "15:00", title: "和产品同步需求变更" },
          { time: "17:30", title: "整理会议纪要并回邮件" },
          { time: "20:00", title: "半小时散步放空" },
        ],
        "明天": [
          { time: "10:00", title: "项目周会" },
          { time: "14:00", title: "方案评审" },
        ],
      };

      return JSON.stringify(
        {
          day,
          items: schedules[day] ?? schedules["今天"],
          source: "mock-calendar-service",
        },
        null,
        2
      );
    },
    {
      name: "get_schedule",
      description: "查询某一天剩余的日程安排。",
      schema: z.object({
        day: z.string().min(1).describe("要查询哪一天的日程。"),
      }),
    }
  );
}

function inferCity(input: string): string {
  const supportedCities = ["上海", "北京", "杭州", "深圳"];

  return supportedCities.find((city) => input.includes(city)) ?? "上海";
}

function inferDay(input: string): string {
  if (input.includes("明天")) {
    return "明天";
  }

  return "今天";
}

function hasBaseSystemMessage(messages: BaseMessage[]): boolean {
  return messages.some((message) => message instanceof SystemMessage && message.text === BASE_SYSTEM_PROMPT);
}

function getLastAiMessage(messages: BaseMessage[]): AIMessage {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (AIMessage.isInstance(message)) {
      return message;
    }
  }

  throw new Error("Expected an AIMessage in the current workflow state.");
}

async function detectEmotion(chatModel: ChatOpenAI, input: string): Promise<Pick<WorkflowState, "emotion" | "emotionReason">> {
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

  return prompt.pipe(structuredModel).invoke({ input });
}

function buildGraph(chatModel: ChatOpenAI) {
  const weatherTool = createWeatherTool();
  const scheduleTool = createScheduleTool();
  const modelWithTools = chatModel.bindTools([weatherTool, scheduleTool]);

  async function startTurnNode(state: WorkflowState): Promise<WorkflowUpdate> {
    const messages = hasBaseSystemMessage(state.messages)
      ? [new HumanMessage(state.userInput)]
      : [new SystemMessage(BASE_SYSTEM_PROMPT), new HumanMessage(state.userInput)];

    return {
      messages,
      toolStepCount: 0,
      weatherResult: "",
      scheduleResult: "",
      finalAnswer: "",
    };
  }

  async function analyzeEmotionNode(state: WorkflowState): Promise<WorkflowUpdate> {
    const emotionResult = await detectEmotion(chatModel, state.userInput);

    return {
      emotion: emotionResult.emotion,
      emotionReason: emotionResult.emotionReason,
    };
  }

  async function selectReplyStyleNode(state: WorkflowState): Promise<WorkflowUpdate> {
    const replyStyle = state.emotion === "negative"
      ? "这一轮先接住用户的烦躁和疲惫，再把建议拆成 2 到 3 个短步骤。"
      : state.emotion === "positive"
        ? "这一轮保持轻快自然，先回应情绪，再给清楚建议。"
        : "这一轮保持冷静简洁，先确认情况，再给稳妥安排。";

    return { replyStyle };
  }

  async function callModelNode(state: WorkflowState): Promise<WorkflowUpdate> {
    const response = await modelWithTools.invoke([
      new SystemMessage(state.replyStyle),
      ...state.messages,
    ]);

    const normalizedResponse = response.tool_calls && response.tool_calls.length > 1
      ? new AIMessage({
          content: response.content,
          tool_calls: [response.tool_calls[0]],
          invalid_tool_calls: response.invalid_tool_calls,
          usage_metadata: response.usage_metadata,
        })
      : response;

    return {
      messages: [normalizedResponse],
      finalAnswer: normalizedResponse.tool_calls && normalizedResponse.tool_calls.length > 0
        ? ""
        : normalizedResponse.text.trim(),
    };
  }

  async function callToolNode(state: WorkflowState): Promise<WorkflowUpdate> {
    const lastAiMessage = getLastAiMessage(state.messages);
    const toolCall = lastAiMessage.tool_calls?.[0];

    if (!toolCall) {
      throw new Error("callTool node expected at least one tool call.");
    }

    let toolMessage: ToolMessage;
    let weatherResult = state.weatherResult;
    let scheduleResult = state.scheduleResult;

    if (toolCall.name === "get_weather") {
      const city = typeof toolCall.args?.city === "string" ? toolCall.args.city : inferCity(state.userInput);
      const day = typeof toolCall.args?.day === "string" ? toolCall.args.day : inferDay(state.userInput);
      const result = await weatherTool.invoke({
        type: "tool_call",
        id: toolCall.id ?? `weather_lookup_${state.toolStepCount + 1}`,
        name: "get_weather",
        args: { city, day },
      });

      if (!ToolMessage.isInstance(result)) {
        throw new Error("Expected weather tool to return a ToolMessage.");
      }

      toolMessage = result;
      weatherResult = toolMessage.text;
    } else if (toolCall.name === "get_schedule") {
      const day = typeof toolCall.args?.day === "string" ? toolCall.args.day : inferDay(state.userInput);
      const result = await scheduleTool.invoke({
        type: "tool_call",
        id: toolCall.id ?? `schedule_lookup_${state.toolStepCount + 1}`,
        name: "get_schedule",
        args: { day },
      });

      if (!ToolMessage.isInstance(result)) {
        throw new Error("Expected schedule tool to return a ToolMessage.");
      }

      toolMessage = result;
      scheduleResult = toolMessage.text;
    } else {
      toolMessage = new ToolMessage({
        content: `Unsupported tool: ${toolCall.name}`,
        tool_call_id: toolCall.id ?? `unsupported_tool_${state.toolStepCount + 1}`,
        status: "error",
      });
    }

    return {
      messages: [toolMessage],
      toolStepCount: state.toolStepCount + 1,
      weatherResult,
      scheduleResult,
    };
  }

  async function finishTurnNode(state: WorkflowState): Promise<WorkflowUpdate> {
    const finalAnswer = getLastAiMessage(state.messages).text.trim();

    return { finalAnswer };
  }

  return new StateGraph(workflowState)
    .addNode("startTurn", startTurnNode)
    .addNode("analyzeEmotion", analyzeEmotionNode)
    .addNode("selectReplyStyle", selectReplyStyleNode)
    .addNode("callModel", callModelNode)
    .addNode("callTool", callToolNode)
    .addNode("finishTurn", finishTurnNode)
    .addEdge(START, "startTurn")
    .addEdge("startTurn", "analyzeEmotion")
    .addEdge("analyzeEmotion", "selectReplyStyle")
    .addEdge("selectReplyStyle", "callModel")
    .addConditionalEdges("callModel", routeAfterModel)
    .addEdge("callTool", "callModel")
    .addEdge("finishTurn", END)
    .compile({
      checkpointer: new MemorySaver(),
    });
}

function routeAfterModel(state: WorkflowState): "callTool" | "finishTurn" {
  const lastAiMessage = getLastAiMessage(state.messages);
  const toolCalls = lastAiMessage.tool_calls ?? [];

  if (toolCalls.length === 0 || state.toolStepCount >= MAX_TOOL_STEPS) {
    return "finishTurn";
  }

  return "callTool";
}

function toMessageLine(message: BaseMessage): string {
  if (message instanceof SystemMessage) {
    return `system: ${message.text}`;
  }

  if (message instanceof HumanMessage) {
    return `human: ${message.text}`;
  }

  if (message instanceof ToolMessage) {
    return `tool(${message.tool_call_id}): ${message.text}`;
  }

  if (message instanceof AIMessage) {
    return `ai: ${message.text}`;
  }

  return `${message.getType()}: ${message.text}`;
}

function formatUnknown(value: unknown): string {
  if (Array.isArray(value) && value.every((item) => item instanceof BaseMessage)) {
    return value.map((item) => toMessageLine(item)).join("\n");
  }

  if (value instanceof BaseMessage) {
    return toMessageLine(value);
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

function printPatch(update: Record<string, unknown>) {
  for (const [key, value] of Object.entries(update)) {
    console.log(`  ${key}:`);
    console.log(formatUnknown(value));
  }
}

function printSnapshot(state: WorkflowState) {
  console.log(`  emotion: ${state.emotion}`);
  console.log(`  emotionReason: ${state.emotionReason}`);
  console.log(`  toolStepCount: ${state.toolStepCount}`);
  console.log(`  finalAnswer: ${state.finalAnswer || "<pending>"}`);
  console.log(`  messages: ${state.messages.length}`);

  if (state.messages.length > 0) {
    console.log(`  lastMessage: ${toMessageLine(state.messages.at(-1) as BaseMessage)}`);
  }
}

async function printCheckpointStats(graph: ReturnType<typeof buildGraph>, threadId: string) {
  const state = await graph.getState({
    configurable: {
      thread_id: threadId,
    },
  });

  console.log("Checkpoint next nodes:", state.next.length > 0 ? state.next.join(", ") : "<end>");
  console.log("Checkpoint stored messages:", state.values.messages.length);
  console.log("Checkpoint latest answer:", state.values.finalAnswer || "<empty>");
}

async function runUpdatesExample(graph: ReturnType<typeof buildGraph>, turn: ConversationTurn) {
  console.log("\n==================================================");
  console.log(`Case: ${turn.label}`);
  console.log(`thread_id: ${THREAD_ID}`);
  console.log(`Input: ${turn.input}`);
  console.log("streamMode=updates 输出每个节点写回 state 的增量。\n");

  const stream = await graph.stream(
    { userInput: turn.input },
    {
      configurable: {
        thread_id: THREAD_ID,
      },
      streamMode: "updates",
    }
  );

  for await (const chunk of stream) {
    for (const [nodeName, update] of Object.entries(chunk)) {
      console.log(`[updates] node=${nodeName}`);
      printPatch(update as Record<string, unknown>);
    }
  }

  await printCheckpointStats(graph, THREAD_ID);
}

async function runValuesExample(graph: ReturnType<typeof buildGraph>, turn: ConversationTurn) {
  console.log("\n==================================================");
  console.log(`Case: ${turn.label}`);
  console.log(`thread_id: ${THREAD_ID}`);
  console.log(`Input: ${turn.input}`);
  console.log("streamMode=values 输出每一步执行后的完整 state 快照。\n");

  const stream = await graph.stream(
    { userInput: turn.input },
    {
      configurable: {
        thread_id: THREAD_ID,
      },
      streamMode: "values",
    }
  );

  for await (const snapshot of stream) {
    console.log("[values] snapshot");
    printSnapshot(snapshot);
  }

  await printCheckpointStats(graph, THREAD_ID);
}

async function runMessagesExample(graph: ReturnType<typeof buildGraph>, turn: ConversationTurn) {
  console.log("\n==================================================");
  console.log(`Case: ${turn.label}`);
  console.log(`thread_id: ${THREAD_ID}`);
  console.log(`Input: ${turn.input}`);
  console.log("streamMode=messages 会把模型 token 片段持续吐出来。\n");

  const stream = await graph.stream(
    { userInput: turn.input },
    {
      configurable: {
        thread_id: THREAD_ID,
      },
      streamMode: "messages",
    }
  );

  let currentNode = "";

  for await (const [message, metadata] of stream) {
    if (!message.text) {
      continue;
    }

    const nodeName = typeof metadata.langgraph_node === "string" ? metadata.langgraph_node : "unknown-node";

    if (nodeName !== currentNode) {
      currentNode = nodeName;
      process.stdout.write(`\n[messages] node=${nodeName}\n`);
    }

    process.stdout.write(message.text);
  }

  process.stdout.write("\n");
  await printCheckpointStats(graph, THREAD_ID);
}

async function main() {
  const { model, chatModel } = createChatModel();
  const graph = buildGraph(chatModel);

  console.log("Model:", model);
  console.log("LangGraph demo: checkpoint + multi-turn thread + graph.stream modes");
  console.log("Shared thread_id:", THREAD_ID);

  await runUpdatesExample(graph, CONVERSATION_TURNS[0]);
  await runValuesExample(graph, CONVERSATION_TURNS[1]);
  await runMessagesExample(graph, CONVERSATION_TURNS[2]);
}

main().catch((error) => {
  console.error("emotion-checkpoint-stream failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});