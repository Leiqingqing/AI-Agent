import dotenv from "dotenv";

import { tool } from "@langchain/core/tools";
import { ToolMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

dotenv.config({ path: ".env.ds", quiet: true });

const USER_QUESTION = "帮我查一下上海今天的天气，并顺便告诉我是否适合出门。";

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function createWeatherTool() {
  return tool(
    async ({ city, unit, day }) => {
      const forecasts: Record<string, { condition: string; temperatureC: number; humidity: number; windLevel: string }> = {
        "上海": { condition: "多云", temperatureC: 26, humidity: 72, windLevel: "3级" },
        "北京": { condition: "晴", temperatureC: 29, humidity: 40, windLevel: "2级" },
        "杭州": { condition: "小雨", temperatureC: 24, humidity: 88, windLevel: "2级" },
        "深圳": { condition: "阵雨", temperatureC: 30, humidity: 79, windLevel: "4级" },
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
          : "总体舒适，适合出门。";

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

function printStep(title: string) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  const apiKey = getRequiredEnv("DEEPSEEK_API_KEY");
  const baseURL = getRequiredEnv("DEEPSEEK_BASE_URL");
  const model = getRequiredEnv("DEEPSEEK_MODEL");

  const chatModel = new ChatOpenAI({
    apiKey,
    model,
    temperature: 0,
    configuration: {
      baseURL,
    },
  });

  const weatherTool = createWeatherTool();
  const modelWithTools = chatModel.bindTools([weatherTool]);
  const messages = [
    {
      role: "system" as const,
      content: "你是一个天气助手。遇到天气问题时，先调用 get_weather，再根据 tool 结果用中文给出简洁回答。",
    },
    {
      role: "user" as const,
      content: USER_QUESTION,
    },
  ];

  printStep("1. 用户问题");
  console.log(USER_QUESTION);

  printStep("2. 模型先决定是否调用 tool");
  const firstResponse = await modelWithTools.invoke(messages);
  console.log("模型原始文本:", firstResponse.text || "<empty>");
  console.log("tool_calls:", JSON.stringify(firstResponse.tool_calls ?? [], null, 2));

  const toolCall = firstResponse.tool_calls?.[0];

  if (!toolCall) {
    throw new Error("Model did not request the weather tool. Try adjusting the prompt or provider model.");
  }

  printStep("3. 代码手动执行 tool");
  console.log("将要执行的参数:", JSON.stringify(toolCall.args, null, 2));
  const toolResult = await weatherTool.invoke(toolCall);

  if (!ToolMessage.isInstance(toolResult)) {
    throw new Error("Expected tool invocation to return a ToolMessage.");
  }

  console.log("tool 返回结果:", toolResult.content);

  printStep("4. 把 tool 结果回传给模型，生成最终答复");
  const finalResponse = await modelWithTools.invoke([
    ...messages,
    firstResponse,
    toolResult,
  ]);

  console.log(finalResponse.text);
}

main().catch((error) => {
  console.error("manual-weather-tool failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});