import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { MessagesValue, ReducedValue, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";

const messageEntrySchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const tagEntrySchema = z.object({
  id: z.string(),
  label: z.string(),
});

type MessageEntry = z.infer<typeof messageEntrySchema>;
type TagEntry = z.infer<typeof tagEntrySchema>;

const schemaState = new StateSchema({
  currentTopic: z.string(),
  messages: new ReducedValue(z.array(messageEntrySchema).default(() => []), {
    inputSchema: z.array(messageEntrySchema),
    reducer: (current, update) => current.concat(update),
  }),
  chatHistory: MessagesValue,
  totalScore: new ReducedValue(z.number().default(0), {
    inputSchema: z.number(),
    reducer: (current, update) => current + update,
  }),
  uniqueTags: new ReducedValue(z.array(tagEntrySchema).default(() => []), {
    inputSchema: z.array(tagEntrySchema),
    reducer: (current, update) => {
      const merged = current.concat(update);
      const uniqueById = new Map<string, TagEntry>();

      for (const item of merged) {
        uniqueById.set(item.id, item);
      }

      return Array.from(uniqueById.values());
    },
  }),
});

type SchemaState = typeof schemaState.State;
type SchemaStateUpdate = typeof schemaState.Update;

function printStep(title: string, update: SchemaStateUpdate) {
  console.log(`\n[${title}] returned update:`);
  console.dir(update, { depth: null });
}

function toMessageLine(message: BaseMessage): string {
  if (message instanceof HumanMessage) {
    return `human: ${message.text}`;
  }

  if (message instanceof AIMessage) {
    return `ai: ${message.text}`;
  }

  return `${message.getType()}: ${message.text}`;
}

function printFinalState(state: SchemaState) {
  console.log("\nFinal merged state:");
  console.dir(state, { depth: null });

  console.log("\nMessagesValue chatHistory:");

  for (const message of state.chatHistory) {
    console.log(`- ${toMessageLine(message)}`);
  }

  console.log("\nWhy each field looks like this:");
  console.log(`- currentTopic: -> ${state.currentTopic}`);
  console.log(`- messages: -> ${state.messages.length} items`);
  console.log(`- chatHistory: -> ${state.chatHistory.length} items`);
  console.log(`- totalScore: -> ${state.totalScore}`);
  console.log(`- uniqueTags: -> ${state.uniqueTags.length} items`);
}

function buildGraph() {
  async function draftTopicNode(): Promise<SchemaStateUpdate> {
    const update = {
      currentTopic: "先聊项目复盘",
    };

    printStep("draftTopic", update);

    return update;
  }

  async function startDiscussionNode(): Promise<SchemaStateUpdate> {
    const update = {
      currentTopic: "改成聊 schemaState reducer",
      messages: [
        { role: "user" as const, content: "我想看 state 默认覆盖行为。" },
        { role: "assistant" as const, content: "默认没有 reducer 的字段，后写入的值会直接覆盖前面的值。" },
      ],
      chatHistory: [
        new HumanMessage("我想顺便看看 MessagesValue 怎么存消息。"),
        new AIMessage("MessagesValue 会把返回的 BaseMessage 按官方消息 reducer 合并进 state。"),
      ],
      totalScore: 2,
      uniqueTags: [
        { id: "overwrite", label: "直接覆盖" },
        { id: "append", label: "列表追加" },
      ],
    };

    printStep("startDiscussion", update);

    return update;
  }

  async function continueDiscussionNode(): Promise<SchemaStateUpdate> {
    const update = {
      currentTopic: "最后聚焦四种更新方式",
      messages: [
        { role: "user" as const, content: "那数字累加和对象去重怎么写？" },
        { role: "assistant" as const, content: "给字段定义 reducer；一个做加法，一个按 id 去重即可。" },
      ],
      chatHistory: [
        new HumanMessage("如果我继续往这个字段里塞消息，会不会自动追加？"),
        new AIMessage("会，MessagesValue 就是为 LangChain 消息列表准备的预置 state 字段。"),
      ],
      totalScore: 3,
      uniqueTags: [
        { id: "append", label: "消息追加" },
        { id: "sum", label: "数字累加" },
        { id: "dedupe", label: "对象去重" },
      ],
    };

    printStep("continueDiscussion", update);

    return update;
  }

  return new StateGraph(schemaState)
    .addNode("draftTopic", draftTopicNode)
    .addNode("startDiscussion", startDiscussionNode)
    .addNode("continueDiscussion", continueDiscussionNode)
    .addEdge(START, "draftTopic")
    .addEdge("draftTopic", "startDiscussion")
    .addEdge("startDiscussion", "continueDiscussion")
    .compile();
}

async function main() {
  const graph = buildGraph();

  const result = await graph.invoke({});

  printFinalState(result);
}

main().catch((error) => {
  console.error("schema-state-reducers failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});