import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { TraceRecord, WriteTraceFileOptions } from "./types.js";

function sanitizePathPart(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-").replace(/\s+/g, "-");
}

export async function writeTraceFile(trace: TraceRecord, options: WriteTraceFileOptions): Promise<string> {
  const fileName = options.fileName ?? `${sanitizePathPart(trace.traceId)}.json`;
  const outputDir = options.outputDir;

  await mkdir(outputDir, { recursive: true });

  const filePath = path.join(outputDir, fileName);
  await writeFile(filePath, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
  return filePath;
}