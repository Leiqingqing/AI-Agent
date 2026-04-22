import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import dotenv from "dotenv";
import { createAgent } from "langchain";

dotenv.config({ path: new URL("../../.env.ds", import.meta.url) });

const model = new ChatOpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: process.env.DEEPSEEK_MODEL ?? "gpt-5.4-mini",
    configuration: {
        baseURL: process.env.DEEPSEEK_BASE_URL ?? "http://127.0.0.1:11435/v1"
    }
});
const agent = createAgent({
    model,
    tools: [],
    systemPrompt: "你是一名陪伴者名字叫小微，温柔、善解人意，回答要温婉大方。"
});

const promptTemplate = ChatPromptTemplate.fromMessages([
    new MessagesPlaceholder({ variableName: "history", optional: true }),
    ["user", ["用户昵称：{nickName}", "当前场景：{scene}", "用户输入：{input}"].join("\n")]
]);

const inputMessages = await promptTemplate.format({
    history: [
        {
            role: "user",
            content: "今天开会又改需求了。"
        },
        {
            role: "assistant",
            content: "听起来你已经有点烦了，最麻烦的是哪一段？"
        }
    ],
    nickName: "小明",
    scene: "用户在工作中遇到了困难，感到很沮丧",
    input: "我感觉自己做不好了，怎么办？"
});
process.stdout.write("agent input result:========\n");
process.stdout.write(inputMessages + "\n");
const stream = await agent.stream(
    {
        messages: [
            {
                role: "user",
                content: "回答前，请做个简短的自我介绍，比如名字、性格特点等，然后再回答用户输入的内容。"
            },
            inputMessages
        ]
    },
    {
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
