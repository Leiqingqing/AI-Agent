import dotenv from "dotenv";

import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { END, MessagesValue, ReducedValue, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";

dotenv.config({ path: ".env.ds", quiet: true });

const USER_INPUT = "今天开会被连续追问，心里有点烦。帮我看看上海今天的天气，再看看我今天剩下的日程怎么安排。";
const MAX_TOOL_STEPS = 4;
const GLOBAL_AGENT_PROMPT = "如果需要处理多件事情，按照顺序依次执行；同一轮最多只调用一个工具。";

const emotionSchema = z.object({
  emotion: z.enum(["positive", "neutral", "negative"]),
  emotionReason: z.string(),
});

const schemaState = new StateSchema({
  userInput: z.string(),
  emotion: z.enum(["positive", "neutral", "negative"]).default("neutral"),
  emotionReason: z.string().default(""),
  systemPrompt: z.string().default(""),
  messages: MessagesValue,
  firstReply: z.string().default(""),
  finalAnswer: z.string().default(""),
  exitReason: z.string().default(""),
  toolStepCount: new ReducedValue(z.number().default(0), {
    inputSchema: z.number(),
    reducer: (current, update) => current + update,
  }),
  weatherResult: z.string().default(""),
  scheduleResult: z.string().default(""),
  executionLog: new ReducedValue(z.array(z.string()).default(() => []), {
    inputSchema: z.string(),
    reducer: (current, update) => current.concat(update),
  }),
});

type WorkflowState = typeof schemaState.State;
type WorkflowUpdate = typeof schemaState.Update;

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
      const forecasts: Record<string, { condition: string; temperatureC: number; humidity: number; advice: string }> = {
        "上海": { condition: "多云转小雨", temperatureC: 26, humidity: 78, advice: "建议带伞，通勤可以正常安排。" },
        "北京": { condition: "晴", temperatureC: 28, humidity: 42, advice: "适合出门，注意午后防晒。" },
        "杭州": { condition: "阵雨", temperatureC: 24, humidity: 84, advice: "外出最好备伞，行程留一点机动时间。" },
        "深圳": { condition: "闷热有雷阵雨", temperatureC: 31, humidity: 81, advice: "不建议长时间户外停留，注意补水。" },
      };

      const forecast = forecasts[city] ?? forecasts["上海"];

      return JSON.stringify(
        {
          city,
          day,
          condition: forecast.condition,
          temperatureC: forecast.temperatureC,
          humidity: `${forecast.humidity}%`,
          advice: forecast.advice,
          source: "mock-weather-service",
        },
        null,
        2
      );
    },
    {
      name: "get_weather",
      description: "查询某个城市某一天的天气信息。",
      schema: z.object({
        city: z.string().min(1).describe("要查询天气的城市。"),
        day: z.string().min(1).describe("要查询的时间，例如今天、明天。"),
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

  if (input.includes("周末")) {
    return "周末";
  }

  return "今天";
}

function printStep(step: string) {
  console.log(`\n=== ${step} ===`);
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

  const chain = prompt.pipe(structuredModel);

  return chain.invoke({ input });
}

function getLastAiMessage(messages: BaseMessage[]): AIMessage {
  const lastMessage = messages.at(-1);

  if (!lastMessage || !AIMessage.isInstance(lastMessage)) {
    throw new Error("Expected the last message in state to be an AIMessage.");
  }

  return lastMessage;
}

function buildGraph(chatModel: ChatOpenAI) {
  const weatherTool = createWeatherTool();
  const scheduleTool = createScheduleTool();
  const modelWithTools = chatModel.bindTools([weatherTool, scheduleTool]);

  async function startNode(state: WorkflowState): Promise<WorkflowUpdate> {
    printStep("start");
    console.log("收到用户输入:", state.userInput);
    console.log("Global prompt:", GLOBAL_AGENT_PROMPT);

    return {
      messages: [new SystemMessage(GLOBAL_AGENT_PROMPT)],
      executionLog: "start",
    };
  }

  async function analyzeEmotionNode(state: WorkflowState): Promise<WorkflowUpdate> {
    printStep("analyzeEmotion");
    const emotionResult = await detectEmotion(chatModel, state.userInput);
    console.log("emotion:", emotionResult.emotion);
    console.log("reason:", emotionResult.emotionReason);

    return {
      emotion: emotionResult.emotion,
      emotionReason: emotionResult.emotionReason,
      executionLog: "analyzeEmotion",
    };
  }

  async function addPositivePromptNode(state: WorkflowState): Promise<WorkflowUpdate> {
    const systemPrompt = "你是一名节奏轻稳的中文助手。先接住用户情绪，再给出清楚可执行的建议。";

    printStep("addPositivePrompt");
    console.log(systemPrompt);

    return {
      systemPrompt,
      messages: [new SystemMessage(systemPrompt), new HumanMessage(state.userInput)],
      executionLog: "addPositivePrompt",
    };
  }

  async function addNeutralPromptNode(state: WorkflowState): Promise<WorkflowUpdate> {
    const systemPrompt = "你是一名冷静、简洁的中文助手。先讲清情况，再给出稳妥安排。";

    printStep("addNeutralPrompt");
    console.log(systemPrompt);

    return {
      systemPrompt,
      messages: [new SystemMessage(systemPrompt), new HumanMessage(state.userInput)],
      executionLog: "addNeutralPrompt",
    };
  }

  async function addNegativePromptNode(state: WorkflowState): Promise<WorkflowUpdate> {
    const systemPrompt = "你是一名温和、克制的中文助手。先回应用户的烦躁和疲惫，再把建议拆小。";

    printStep("addNegativePrompt");
    console.log(systemPrompt);

    return {
      systemPrompt,
      messages: [new SystemMessage(systemPrompt), new HumanMessage(state.userInput)],
      executionLog: "addNegativePrompt",
    };
  }

  async function callModelNode(state: WorkflowState): Promise<WorkflowUpdate> {
    printStep("callModel");
    const response = await modelWithTools.invoke(state.messages);
    const normalizedResponse = response.tool_calls && response.tool_calls.length > 1
      ? new AIMessage({
          content: response.content,
          tool_calls: [response.tool_calls[0]],
          invalid_tool_calls: response.invalid_tool_calls,
          usage_metadata: response.usage_metadata,
        })
      : response;

    console.log(normalizedResponse.text.trim());
    console.log("tool_calls:", JSON.stringify(normalizedResponse.tool_calls ?? [], null, 2));

    return {
      firstReply: state.firstReply || normalizedResponse.text.trim(),
      messages: [normalizedResponse],
      executionLog: "callModel",
    };
  }

  async function callToolNode(state: WorkflowState): Promise<WorkflowUpdate> {
    printStep("callTool");
    const lastAiMessage = getLastAiMessage(state.messages);
    const toolCalls = lastAiMessage.tool_calls ?? [];

    if (toolCalls.length === 0) {
      throw new Error("callTool node expected at least one tool call.");
    }

    const toolCall = toolCalls[0];
    let weatherResult = state.weatherResult;
    let scheduleResult = state.scheduleResult;
    let toolMessage: ToolMessage;

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

    console.log(`[${toolCall.name}]`);
    console.log(toolMessage.text);

    return {
      weatherResult,
      scheduleResult,
      toolStepCount: 1,
      messages: [toolMessage],
      executionLog: `callTool:${toolCall.name}`,
    };
  }

  async function normalExitNode(state: WorkflowState): Promise<WorkflowUpdate> {
    printStep("normalExit");
    const lastAiMessage = getLastAiMessage(state.messages);
    const finalAnswer = lastAiMessage.text.trim();
    console.log(finalAnswer);

    return {
      finalAnswer,
      exitReason: "normal",
      executionLog: "normalExit",
    };
  }

  async function safeExitNode(state: WorkflowState): Promise<WorkflowUpdate> {
    printStep("safeExit");
    const fallbackAnswer = [
      "工具调用次数达到安全上限，先在这里收口。",
      state.weatherResult ? `已拿到天气信息：${state.weatherResult}` : "天气信息尚未成功拿到。",
      state.scheduleResult ? `已拿到日程信息：${state.scheduleResult}` : "日程信息尚未成功拿到。",
      "你可以调整提示词后再继续尝试。",
    ].join("\n");
    console.log(fallbackAnswer);

    return {
      finalAnswer: fallbackAnswer,
      exitReason: "safe",
      executionLog: "safeExit",
    };
  }

  return new StateGraph(schemaState)
    .addNode("startNode", startNode)
    .addNode("analyzeEmotion", analyzeEmotionNode)
    .addNode("addPositivePrompt", addPositivePromptNode)
    .addNode("addNeutralPrompt", addNeutralPromptNode)
    .addNode("addNegativePrompt", addNegativePromptNode)
    .addNode("callModel", callModelNode)
    .addNode("callTool", callToolNode)
    .addNode("normalExit", normalExitNode)
    .addNode("safeExit", safeExitNode)
    .addEdge(START, "startNode")
    .addEdge("startNode", "analyzeEmotion")
    .addConditionalEdges("analyzeEmotion", routeByEmotion)
    .addEdge("addPositivePrompt", "callModel")
    .addEdge("addNeutralPrompt", "callModel")
    .addEdge("addNegativePrompt", "callModel")
    .addConditionalEdges("callModel", routeAfterModel)
    .addEdge("callTool", "callModel")
    .addEdge("normalExit", END)
    .addEdge("safeExit", END)
    .compile();
}

function routeByEmotion(state: WorkflowState): "addPositivePrompt" | "addNeutralPrompt" | "addNegativePrompt" {
  switch (state.emotion) {
    case "positive":
      return "addPositivePrompt";
    case "negative":
      return "addNegativePrompt";
    default:
      return "addNeutralPrompt";
  }
}

function routeAfterModel(state: WorkflowState): "callTool" | "normalExit" | "safeExit" {
  const lastAiMessage = getLastAiMessage(state.messages);
  const toolCalls = lastAiMessage.tool_calls ?? [];

  if (toolCalls.length === 0) {
    return "normalExit";
  }

  if (state.toolStepCount >= MAX_TOOL_STEPS) {
    return "safeExit";
  }

  return "callTool";
}

function printFinalState(model: string, state: WorkflowState) {
  console.log("\n=== finalState ===");
  console.log("Model:", model);
  console.log("Emotion:", state.emotion);
  console.log("Emotion reason:", state.emotionReason);
  console.log("System prompt:", state.systemPrompt);
  console.log("First reply:", state.firstReply);
  console.log("Final answer:", state.finalAnswer);
  console.log("Exit reason:", state.exitReason);
  console.log("Tool step count:", state.toolStepCount);
  console.log("Weather result:", state.weatherResult);
  console.log("Schedule result:", state.scheduleResult);
  console.log("Execution log:", state.executionLog.join(" -> "));
  console.log("\nMessages timeline:");

  for (const message of state.messages) {
    console.log(`- ${toMessageLine(message)}`);
  }
}

async function main() {
  const { model, chatModel } = createChatModel();
  const graph = buildGraph(chatModel);

  const result = await graph.invoke({
    userInput: USER_INPUT,
  });

  printFinalState(model, result);
}

main().catch((error) => {
  console.error("emotion-tool-workflow failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});