import { stat, open, readFile } from "fs/promises";
import type { JsonlEntry } from "../schemas/jsonl.js";

/** Read the last N bytes of a file and return complete JSONL lines */
export async function tailFile(filePath: string, bytes = 16384): Promise<string[]> {
  let fh: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const info = await stat(filePath);
    fh = await open(filePath, "r");
    const start = Math.max(0, info.size - bytes);
    const buf = Buffer.alloc(Math.min(bytes, info.size));
    await fh.read(buf, 0, buf.length, start);
    const text = buf.toString("utf-8");
    const lines = text.split("\n");
    if (start > 0) lines.shift(); // drop first potentially partial line
    return lines.filter((l) => l.trim());
  } catch {
    return [];
  } finally {
    await fh?.close();
  }
}

/** Read a full JSONL file and parse each line into a JSON object */
export async function readFullConversation(jsonlPath: string): Promise<JsonlEntry[]> {
  const raw = await readFile(jsonlPath, "utf-8");
  const entries: JsonlEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as JsonlEntry);
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

/** Read multiple JSONL files, dedup by uuid, sort by timestamp */
export async function readFullConversationMulti(jsonlPaths: string[]): Promise<JsonlEntry[]> {
  const seen = new Set<string>();
  const entries: JsonlEntry[] = [];
  for (const p of jsonlPaths) {
    try {
      const raw = await readFile(p, "utf-8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          const uuid = (entry.uuid ?? entry.requestId ?? line.slice(0, 50)) as string;
          if (!seen.has(uuid)) {
            seen.add(uuid);
            entries.push(entry as JsonlEntry);
          }
        } catch {}
      }
    } catch {}
  }
  entries.sort((a, b) => {
    const ta = "timestamp" in a && a.timestamp ? new Date(a.timestamp as string).getTime() : 0;
    const tb = "timestamp" in b && b.timestamp ? new Date(b.timestamp as string).getTime() : 0;
    return ta - tb;
  });
  return entries;
}
