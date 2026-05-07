import { readFile } from "node:fs/promises";
import path from "node:path";

import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const README_PATH = path.resolve(process.cwd(), "..", "..", "README.md");

function preview(text: string, maxLength = 120): string {
  const compact = text.replace(/\s+/g, " ").trim();

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength)}...`;
}

async function main() {
  const content = await readFile(README_PATH, "utf8");
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 220,
    chunkOverlap: 40,
    separators: ["\n## ", "\n### ", "\n- ", "\n", " ", ""],
  });
  const sourceDocument = new Document({
    pageContent: content,
    metadata: {
      source: README_PATH,
      title: "AI-Agent README",
    },
  });
  const chunks = await splitter.splitDocuments([sourceDocument]);

  console.log("Document split demo: README.md");
  console.log("Source:", README_PATH);
  console.log("Original characters:", content.length);
  console.log("Chunk count:", chunks.length);
  console.log("Chunk size:", 220);
  console.log("Chunk overlap:", 40);

  chunks.forEach((chunk, index) => {
    console.log("\n----------------------------------------");
    console.log(`Chunk ${index + 1}`);
    console.log("Characters:", chunk.pageContent.length);
    console.log("Metadata:", JSON.stringify(chunk.metadata, null, 2));
    console.log("Preview:", preview(chunk.pageContent));
  });
}

main().catch((error) => {
  console.error("document-split-readme failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});