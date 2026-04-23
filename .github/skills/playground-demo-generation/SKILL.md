---
name: playground-demo-generation
description: 'Generate LangChain playground demo files for this repository. Use when creating a new demo/example under playgrounds. Enforce one demo per file, camelCase filenames, no model names in filenames, no generic demo-only filenames, createAgent() for model calls, and streaming output.'
argument-hint: 'Describe the demo topic, target playground folder, and expected behavior'
user-invocable: true
---

# Playground Demo Generation

## When to Use

- Create a new TypeScript or Markdown demo file under `playgrounds/`
- Add a runnable LangChain example to an existing playground
- Standardize demo naming and invocation style across playground files

## Required Rules

1. One demo per file.
2. Use camelCase filenames.
3. Filename should express the file responsibility, such as `firstTry.ts`, `streamExample.ts`, `summaryNote.md`.
4. Do not include specific model names in filenames.
5. Do not use generic names like `demo.ts`, `exampleDemo.ts`, or `chatDemo.ts` unless the file responsibility cannot be expressed more precisely.
6. If the demo calls a model, use agent invocation consistently:

```ts
const agent = createAgent({ ... });
```

7. If the demo prints model output, use streaming output consistently.

## Naming Procedure

1. Determine the file's primary responsibility before naming it.
2. Prefer names that describe the task or behavior, such as `messageProtocol.ts`, `toolCallStream.ts`, `summaryNote.md`, `agentMemoryStep.ts`.
3. Keep the filename technology-agnostic when possible. Avoid provider or model branding in the filename.
4. If two files are similar, differentiate them by behavior, not by adding a vague `demo` suffix.

## Implementation Procedure

1. Place the file in the most specific existing playground folder.
2. Keep the file focused on one runnable scenario.
3. Load environment variables using the repository's existing pattern.
4. Construct the chat model, then wrap it with `createAgent()`.
5. Pass user input through the agent.
6. Stream the response and print chunks progressively.
7. Reuse existing helper patterns from nearby playground scripts instead of introducing a new style.

## TypeScript Template

Use this template when adding a model-calling TypeScript demo:

```ts
import dotenv from "dotenv";

import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";

dotenv.config({ path: ".env.ds", quiet: true });

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
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

  const agent = createAgent({
    model: chatModel,
    tools: [],
    systemPrompt: "You are a concise assistant.",
  });

  const stream = await agent.stream(
    {
      messages: [{ role: "user", content: "Explain the concept briefly." }],
    },
    {
      streamMode: "messages",
    }
  );

  process.stdout.write("Reply: ");

  for await (const [chunk] of stream) {
    process.stdout.write(chunk.text);
  }

  process.stdout.write("\n");
}

main().catch((error) => {
  console.error("playground script failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
```

## Final Checklist

- The file adds exactly one demo scenario.
- The filename is camelCase and responsibility-based.
- The filename does not contain a specific model name.
- The filename does not rely on the word `demo` as its main identifier.
- Model invocation uses `createAgent()`.
- Output is streamed instead of using a single non-streaming invoke for the final response.