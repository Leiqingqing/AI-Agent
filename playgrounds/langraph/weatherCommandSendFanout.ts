import { Command, END, ReducedValue, START, Send, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";

const USER_INPUT = "把上海、深圳、广州今天的天气都查一下，我想看看哪边更热。";
const SUPPORTED_CITIES = ["上海", "北京", "杭州", "深圳", "广州"] as const;

const weatherEntrySchema = z.object({
  city: z.string(),
  condition: z.string(),
  temperatureC: z.number(),
  humidity: z.number(),
  advice: z.string(),
});

type WeatherEntry = z.infer<typeof weatherEntrySchema>;

const graphState = new StateSchema({
  userInput: z.string(),
  requestedCities: z.array(z.string()).default(() => []),
  dispatchNote: z.string().default(""),
  weatherResults: new ReducedValue(z.array(weatherEntrySchema).default(() => []), {
    inputSchema: z.array(weatherEntrySchema),
    reducer: (current, update) => current.concat(update),
  }),
  summary: z.string().default(""),
});

const weatherLookupInput = z.object({
  city: z.string(),
});

type GraphState = typeof graphState.State;
type GraphUpdate = typeof graphState.Update;

const MOCK_WEATHER: Record<string, WeatherEntry> = {
  "上海": { city: "上海", condition: "多云转小雨", temperatureC: 26, humidity: 78, advice: "晚点出门带伞。" },
  "北京": { city: "北京", condition: "晴", temperatureC: 28, humidity: 42, advice: "午后注意防晒。" },
  "杭州": { city: "杭州", condition: "阵雨", temperatureC: 24, humidity: 84, advice: "通勤留一点缓冲。" },
  "深圳": { city: "深圳", condition: "闷热有雷阵雨", temperatureC: 31, humidity: 81, advice: "减少长时间户外停留。" },
  "广州": { city: "广州", condition: "阴有雷阵雨", temperatureC: 30, humidity: 83, advice: "带伞并注意闷热。" },
};

function parseCities(input: string): string[] {
  const matches = SUPPORTED_CITIES.filter((city) => input.includes(city));

  return Array.from(new Set(matches));
}

function formatWeather(entry: WeatherEntry): string {
  return `${entry.city}: ${entry.condition}，${entry.temperatureC}°C，湿度 ${entry.humidity}%，建议：${entry.advice}`;
}

function printStep(title: string) {
  console.log(`\n=== ${title} ===`);
}

function buildGraph() {
  async function parseAndDispatchNode(state: GraphState) {
    printStep("parseAndDispatch");
    const requestedCities = parseCities(state.userInput);
    const dispatchNote = requestedCities.length > 0
      ? `准备并行查询 ${requestedCities.length} 个城市：${requestedCities.join("、")}`
      : "没有识别到可查询的城市";

    console.log("input:", state.userInput);
    console.log(dispatchNote);

    if (requestedCities.length === 0) {
      return new Command<unknown, GraphUpdate, "getWeather" | "noCities">({
        update: {
          requestedCities,
          dispatchNote,
        },
        goto: "noCities",
      });
    }

    return new Command<unknown, GraphUpdate, "getWeather" | "noCities">({
      update: {
        requestedCities,
        dispatchNote,
      },
      goto: requestedCities.map((city) => new Send("getWeather", { city })),
    });
  }

  async function getWeatherNode(input: { city: string }): Promise<GraphUpdate> {
    printStep(`getWeather:${input.city}`);
    const weather = MOCK_WEATHER[input.city] ?? {
      city: input.city,
      condition: "未知",
      temperatureC: 0,
      humidity: 0,
      advice: "没有这座城市的 mock 数据。",
    };

    console.log(formatWeather(weather));

    return {
      weatherResults: [weather],
    };
  }

  async function summarizeWeatherNode(state: GraphState): Promise<GraphUpdate> {
    printStep("summarizeWeather");
    const sortedResults = state.requestedCities
      .map((city) => state.weatherResults.find((item) => item.city === city))
      .filter((item): item is WeatherEntry => item !== undefined);

    const hottestCity = sortedResults.reduce<WeatherEntry | null>((current, item) => {
      if (!current || item.temperatureC > current.temperatureC) {
        return item;
      }

      return current;
    }, null);

    const summary = [
      state.dispatchNote,
      ...sortedResults.map((item) => `- ${formatWeather(item)}`),
      hottestCity ? `结论：${hottestCity.city} 最热，当前 ${hottestCity.temperatureC}°C。` : "没有可汇总的天气结果。",
    ].join("\n");

    console.log(summary);

    return { summary };
  }

  async function noCitiesNode(): Promise<GraphUpdate> {
    printStep("noCities");
    const summary = "没有识别到支持的城市。当前 demo 支持：上海、北京、杭州、深圳、广州。";

    console.log(summary);

    return { summary };
  }

  return new StateGraph(graphState)
    .addNode("parseAndDispatch", parseAndDispatchNode, { ends: ["getWeather", "noCities"] })
    .addNode("getWeather", getWeatherNode, { input: weatherLookupInput })
    .addNode("summarizeWeather", summarizeWeatherNode)
    .addNode("noCities", noCitiesNode)
    // 根据 parseAndDispatch 的结果，动态路由到多个 getWeather 节点(并行)，或者直接路由到 noCities 节点
    // 路由与state更新放到一个节点一起处理
    .addEdge(START, "parseAndDispatch")
    .addEdge("getWeather", "summarizeWeather")
    .addEdge("summarizeWeather", END)
    .addEdge("noCities", END)
    .compile();
}

async function main() {
  const graph = buildGraph();
  const result = await graph.invoke({
    userInput: USER_INPUT,
  });

  console.log("\n=== finalState ===");
  console.dir(result, { depth: null });
}

main().catch((error) => {
  console.error("weather-command-send-fanout failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});