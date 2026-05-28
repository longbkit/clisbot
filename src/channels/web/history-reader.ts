import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";
import type { HistoryMessage } from "./transport.ts";

/**
 * Reads chat history from the Claude Code session JSONL file.
 * Returns last `limit` user/assistant message pairs.
 */
export async function readSessionHistory(params: {
  sessionId: string;
  workspacePath: string;
  limit?: number;
}): Promise<HistoryMessage[]> {
  const { sessionId, workspacePath, limit = 50 } = params;

  // Derive project dir: replace / and . with -
  const projectDir = workspacePath.replace(/[/.]/g, "-");
  const jsonlPath = join(homedir(), ".claude", "projects", projectDir, `${sessionId}.jsonl`);

  const messages: HistoryMessage[] = [];

  try {
    const stream = createReadStream(jsonlPath, { encoding: "utf-8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      let entry: Record<string, unknown>;
      try { entry = JSON.parse(line); } catch { continue; }

      const type = entry.type as string;
      if (type !== "user" && type !== "assistant") continue;

      const msg = entry.message as Record<string, unknown> | undefined;
      if (!msg) continue;

      const role = msg.role as string;
      if (role !== "user" && role !== "assistant") continue;

      const content = msg.content;
      let text = "";

      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
          .filter((c) => c.type === "text")
          .map((c) => c.text as string)
          .join("\n");
      }

      // Skip empty, strip context injection block (our own prefixes).
      // Prefer the [USER_INPUT] marker (new sessions); fall back to lastIndexOf('\n\n') for old ones.
      text = text.trim();
      if (!text) continue;
      if (text.startsWith("[Context:") || text.startsWith("[iCloud Reminder:") || text.startsWith("[Task:")) {
        const markerIdx = text.indexOf('\n[USER_INPUT]\n');
        if (markerIdx !== -1) {
          text = text.slice(markerIdx + '\n[USER_INPUT]\n'.length).trim();
        } else {
          const sep = text.lastIndexOf('\n\n');
          text = sep !== -1 ? text.slice(sep + 2).trim() : '';
        }
        if (!text) continue;
      }

      // Strip [[CHANNEL_EVENT:...]] markers (and legacy [[BRIEF_UPDATE:...]])
      text = text.replace(/\[\[CHANNEL_EVENT:[^\]]*?\]\]/gi, "").trim();
      text = text.replace(/\[\[BRIEF_UPDATE:\s*[\s\S]*?\]\]/gi, "").trim();
      text = text.replace(/\[\[CHANNEL_EVENT:[\s\S]*$/i, "").trim();
      if (!text) continue;

      messages.push({ role: role as "user" | "assistant", text });
    }
  } catch {
    // File not found or unreadable — return empty
    return [];
  }

  // Return last N messages
  return messages.slice(-limit);
}
