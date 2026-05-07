import { readFile } from "fs/promises";
import path from "path";

import dotenv from "dotenv";

import { Document } from "@langchain/core/documents";
import { SyntheticEmbeddings } from "@langchain/core/utils/testing";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";

dotenv.config({ path: ".env.ds", quiet: true });

const README_PATH = path.resolve(process.cwd(), "..", "..", "README.md");
const SEARCH_QUERY = "docs 和 playgrounds 各自负责什么？";

function preview(text: string, maxLength = 120): string {
    const compact = text.replace(/\s+/g, " ").trim();

    if (compact.length <= maxLength) {
        return compact;
    }

    return `${compact.slice(0, maxLength)}...`;
}

function getOptionalEnv(name: string): string | undefined {
    const value = process.env[name]?.trim();
    return value ? value : undefined;
}

function createEmbeddings() {
    const apiKey = getOptionalEnv("EMBEDDING_API_KEY");
    const baseURL = getOptionalEnv("EMBEDDING_BASE_URL");

    if (apiKey) {
        return {
            label: "OpenAIEmbeddings(text-embedding-3-small)",
            embeddings: new OpenAIEmbeddings({
                apiKey,
                model: "text-embedding-3-small",
                configuration: baseURL ? { baseURL } : undefined
            })
        };
    }

    return {
        label: "SyntheticEmbeddings(vectorSize=16)",
        // Use a small vector size for testing/demo purposes;
        //  in production, you'd typically use something like 1024 or 2048 depending on the embedding model.
        embeddings: new SyntheticEmbeddings({ vectorSize: 16 })
    };
}

async function loadReadmeChunks() {
    const content = await readFile(README_PATH, "utf8");
    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 220,
        chunkOverlap: 40,
        separators: ["\n## ", "\n### ", "\n- ", "\n", " ", ""]
    });
    const sourceDocument = new Document({
        pageContent: content,
        metadata: {
            source: README_PATH,
            title: "AI-Agent README"
        }
    });
    const chunks = await splitter.splitDocuments([sourceDocument]);

    return {
        content,
        chunks
    };
}

async function main() {
    const { content, chunks } = await loadReadmeChunks();
    const { label, embeddings } = createEmbeddings();
    const vectorStore = await MemoryVectorStore.fromDocuments(chunks, embeddings);
    const results = await vectorStore.similaritySearchWithScore(SEARCH_QUERY, 3);

    console.log("README embedding + vector store demo");
    console.log("Source:", README_PATH);
    console.log("Original characters:", content.length);
    console.log("Chunk count:", chunks.length);
    console.log("Embeddings:", label);
    console.log("Query:", SEARCH_QUERY);

    results.forEach(([document, score], index) => {
        console.log("\n----------------------------------------");
        console.log(`Top ${index + 1}`);
        console.log("Score:", score);
        console.log("Metadata:", JSON.stringify(document.metadata, null, 2));
        console.log("Preview:", preview(document.pageContent, 180));
    });
}

main().catch((error) => {
    console.error("readme-vector-search failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
