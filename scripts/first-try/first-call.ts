import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";

dotenv.config({ path: new URL("../../.env.local", import.meta.url) });

const model = new ChatOpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: process.env.DEEPSEEK_MODEL ?? "gpt-5.4-mini",
    configuration: {
        baseURL: process.env.DEEPSEEK_BASE_URL ?? "http://127.0.0.1:11435/v1"
    }
});

const response = await model.invoke([
    {
        role: "system",
        content: "你是一名面向前端开发者的助手，回答要清楚、简短。"
    },
    {
        role: "user",
        content: "请用两句话确认 LangChain 与 gpt-5.4-mini 的连接已经正常。"
    }
]);

console.log("invoke result:");
console.log(response.text);
