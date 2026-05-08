import path from "node:path";

import dotenv from "dotenv";

import { AIMessageChunk } from "@langchain/core/messages";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import { z } from "zod";

import { createTraceCollector, writeTraceFile } from "./trace/index.js";

dotenv.config({ path: ".env.ds", quiet: true });

const USER_INPUT = "今天改需求改得很烦，帮我看看上海今天的天气，顺便告诉我适不适合出门散步。";

type EmotionOutput = {
  emotion: string;
  confidence?: string | number;
  weather_query?: {
    city?: string;
    date?: string;
  };
  suggestion?: string;
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

function createWeatherTool() {
  return tool(
    async ({ city, unit, day }) => {
      const forecasts: Record<string, { condition: string; temperatureC: number; humidity: number; windLevel: string }> = {
        上海: { condition: "多云", temperatureC: 26, humidity: 72, windLevel: "3级" },
        北京: { condition: "晴", temperatureC: 29, humidity: 40, windLevel: "2级" },
        杭州: { condition: "小雨", temperatureC: 24, humidity: 88, windLevel: "2级" },
        深圳: { condition: "阵雨", temperatureC: 30, humidity: 79, windLevel: "4级" },
      };

      const forecast = forecasts[city] ?? { condition: "晴", temperatureC: 25, humidity: 55, windLevel: "2级" };
      const temperature = unit === "fahrenheit"
        ? Number(((forecast.temperatureC * 9) / 5 + 32).toFixed(1))
        : forecast.temperatureC;
      const temperatureUnit = unit === "fahrenheit" ? "F" : "C";
      const advice = forecast.condition.includes("雨")
        ? "建议带伞，短时出门可以。"
        : forecast.temperatureC >= 30
          ? "天气偏热，适合短时出门，注意补水。"
          : "总体舒适，适合出门散步。";

      return JSON.stringify(
        {
          city,
          day,
          condition: forecast.condition,
          temperature,
          temperatureUnit,
          humidity: `${forecast.humidity}%`,
          windLevel: forecast.windLevel,
          advice,
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
        city: z.string().min(1).describe("要查询天气的城市，比如上海、北京。"),
        day: z.string().describe("要查询的日期描述，比如今天、明天、周末。"),
        unit: z.enum(["celsius", "fahrenheit"]).default("celsius").describe("温度单位。"),
      }),
    }
  );
}

function normalizeEmotionOutput(output: EmotionOutput): { emotion: string; confidence: string } {
  return {
    emotion: output.emotion || "未知",
    confidence: String(output.confidence ?? "medium"),
  };
}

async function analyzeEmotion(chatModel: ChatOpenAI, userInput: string, collector: ReturnType<typeof createTraceCollector>) {
  const parser = new JsonOutputParser<EmotionOutput>();
  const systemPrompt = [
    "你负责做情绪识别。",
    "返回 JSON 时至少包含 emotion 和 confidence 两个字段。",
    "只返回 JSON，不要补充解释。",
    parser.getFormatInstructions(),
  ].join("\n");

  const emotionModel = chatModel.withConfig({ runName: "emotionAnalysis" });
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", systemPrompt],
    ["user", "{input}"],
  ]).withConfig({ runName: "internalEmotionPrompt" });

  const parseChain = prompt.pipe(emotionModel).pipe(parser).withConfig({ runName: "internalEmotionParser" });
  const parsed = await parseChain.invoke(
    { input: userInput },
    {
      callbacks: [collector],
    }
  );

  return normalizeEmotionOutput(parsed);
}

async function main() {
  const { model, chatModel } = createChatModel();
  const collector = createTraceCollector({
    traceName: "emotionWeatherTrace",
    tags: ["trace", "emotion", "weather"],
    metadata: {
      entrypoint: "emotionAnalysis->agent.stream",
      streamMode: "messages",
    },
    input: {
      messages: [{ role: "user", content: USER_INPUT }],
    },
  });

  const emotion = await analyzeEmotion(chatModel, USER_INPUT, collector);
  const weatherTool = createWeatherTool();
  const assistantModel = chatModel.withConfig({ runName: "weatherAssistantModel" });
  const agent = createAgent({
    model: assistantModel,
    tools: [weatherTool],
    systemPrompt: [
      "你是一个简洁的中文助手。",
      `用户当前情绪：${emotion.emotion}。`,
      `情绪置信度：${emotion.confidence}。`,
      "先理解用户情绪再回答问题，如果有多个问题，按顺序回答。",
      "回答保持自然、简短，有一点情绪照顾，但不要过度安慰。",
    ].join("\n"),
  });

  const input = {
    messages: [{ role: "user" as const, content: USER_INPUT }],
  };
  const stream = await agent.stream(input, {
    callbacks: [collector],
    streamMode: "messages",
  });

  let replyText = "";

  console.log("Provider: DeepSeek");
  console.log("Model:", model);
  console.log("Emotion analysis:", JSON.stringify(emotion, null, 2));
  process.stdout.write("Reply: ");

  for await (const [chunk] of stream) {
    if (!AIMessageChunk.isInstance(chunk)) {
      continue;
    }

    replyText += chunk.text;
    process.stdout.write(chunk.text);
  }

  process.stdout.write("\n");

  const trace = collector.finalize({
    output: {
      emotion,
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
    traceName: "emotionWeatherTrace",
    tags: ["trace", "emotion", "weather", "startup-error"],
  });
  const trace = collector.finalize({ error });
  const traceFilePath = await writeTraceFile(trace, {
    outputDir: path.join(process.cwd(), "traces"),
  });

  console.error("emotion-weather-trace failed:", error instanceof Error ? error.message : error);
  console.error("Trace file:", traceFilePath);
  process.exitCode = 1;
});