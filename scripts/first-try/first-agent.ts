import dotenv from "dotenv";
import { createAgent } from "langchain";
import { ChatOpenAI } from "@langchain/openai";

dotenv.config({ path: new URL("../../.env.ds", import.meta.url) });

const model = new ChatOpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: process.env.DEEPSEEK_MODEL ?? "gpt-5.4-mini",
    configuration: {
        baseURL: process.env.DEEPSEEK_BASE_URL ?? "http://127.0.0.1:11435/v1"
    }
});

// 定义 Agent
const agent = createAgent({
    model,
    tools: [],
    systemPrompt: "你是一名面向前端开发者的助手，回答要自然、简短。"
});

// 定义 message
const inputMessages = {
    role: "user",
    content: "请用一句话说明当前是 Agent 流式调用验证。并且说明一下你的身份。"
};

// Agent 调用 stream 流式输出，返回的是消息流
const stream = await agent.stream(
    {
        messages: [inputMessages]
    },
    {
        // 设置 streamMode 为 messages，返回的是消息流
        streamMode: "messages"
    }
);

process.stdout.write("agent stream result:\n");

for await (const [messageChunk] of stream) {
    if (messageChunk.content) {
        setTimeout(() => {
            process.stdout.write(messageChunk.text);
        }, 20);
    }
}

process.stdout.write("\n");
