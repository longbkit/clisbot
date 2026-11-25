import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { buildAgentForkContextAttachment } from "./activity-curator.js";
import { readAgentForkContext } from "./fork-history-reader.js";
import { buildAgentPrompt } from "./prompt-attachments.js";
import { FileAgentTimelineStore } from "./session-storage/file-agent-timeline-store.js";
import { SESSION_STORAGE_LIMITS } from "./session-storage/paged-journal.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function storeWith(rows: AgentTimelineRow[]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fork-history-reader-"));
  roots.push(root);
  const store = new FileAgentTimelineStore(async () => root);
  const epoch = await store.replaceCommitted("agent", rows);
  return {
    store,
    epoch,
    fetch: (options: Parameters<typeof store.fetchCommitted>[1]) =>
      store.fetchCommitted("agent", options),
  };
}

function at(seq: number, item: AgentTimelineItem, turnId = `turn-${Math.ceil(seq / 3)}`) {
  return { seq, timestamp: "2026-11-26T00:00:00.000Z", item, turnId } as AgentTimelineRow;
}

/** User ask, a tool with a large result, an assistant answer: one turn per three rows. */
function longSession(
  turns: number,
  toolOutputBytes: number,
  word = "kết quả 結果 🚀 ",
): AgentTimelineRow[] {
  const rows: AgentTimelineRow[] = [];
  for (let turn = 1; turn <= turns; turn++) {
    const seq = (turn - 1) * 3;
    const turnId = `turn-${turn}`;
    rows.push(
      at(
        seq + 1,
        { type: "user_message", text: `Câu hỏi ${turn}: ${word}`, messageId: `u${turn}` },
        turnId,
      ),
    );
    rows.push(
      at(
        seq + 2,
        {
          type: "tool_call",
          callId: `call-${turn}`,
          name: "Bash",
          status: "completed",
          error: null,
          detail: {
            type: "shell",
            command: `cat log-${turn}.txt`,
            output: word.repeat(Math.ceil(toolOutputBytes / Buffer.byteLength(word))),
          },
        } as AgentTimelineItem,
        turnId,
      ),
    );
    rows.push(
      at(
        seq + 3,
        {
          type: "assistant_message",
          text: `Trả lời ${turn}. ${word.repeat(40)}`,
          messageId: `a${turn}`,
        },
        turnId,
      ),
    );
  }
  return rows;
}

function expectWellFormed(text: string) {
  expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(100_000);
  // No character was cut in two: the text survives a UTF-8 round trip unchanged.
  expect(Buffer.from(text, "utf8").toString("utf8")).toBe(text);
  expect(text).toMatch(/^<chat-history-summary>\n/);
  expect(text).toMatch(/\n<\/chat-history-summary>$/);
}

describe("readAgentForkContext on durable storage", () => {
  it("forks a session whose history exceeds the session page byte budget", async () => {
    const rows = longSession(300, 40_000);
    const { fetch, epoch } = await storeWith(rows);
    expect(Buffer.byteLength(JSON.stringify(rows))).toBeGreaterThan(
      SESSION_STORAGE_LIMITS.readPageBytes,
    );
    // The read every fork path used to make: the whole history in one page.
    await expect(fetch({ direction: "tail", limit: 0 })).rejects.toThrow(
      "Session page exceeds byte budget; request a smaller page",
    );

    const result = await readAgentForkContext({
      fetch,
      sourceAgentId: "agent",
      agentTitle: "Phiên dài 🚀",
      cwd: "/work",
    });
    const { text } = result.attachment;
    expectWellFormed(text);
    expect(text).toContain("[Earlier chat history omitted]");
    expect(text).toContain("[User] Câu hỏi 300:");
    expect(text).toContain("[Assistant] Trả lời 300.");
    expect(text).not.toContain("Câu hỏi 1:");
    expect(result.attachment.sourceSession).toEqual({ agentId: "agent", epoch, seq: 900 });
    // The newest history fills the attachment rather than a token tail.
    expect(Buffer.byteLength(text)).toBeGreaterThan(90_000);

    // Delivered to the provider before a non-empty new message, both intact.
    const prompt = buildAgentPrompt("Tiếp tục nhé", undefined, [result.attachment]);
    expect(prompt).toEqual([result.attachment, { type: "text", text: "Tiếp tục nhé" }]);
  });

  it("forks from an older assistant message deep in a long history", async () => {
    const rows = longSession(300, 40_000);
    const { fetch } = await storeWith(rows);
    const result = await readAgentForkContext({ fetch, boundaryMessageId: "a120" });
    const { text } = result.attachment;
    expectWellFormed(text);
    expect(result.boundaryMessageId).toBe("a120");
    expect(text).toContain("[Assistant] Trả lời 120.");
    expect(text).not.toContain("Câu hỏi 121:");
    expect(text).toContain("[Earlier chat history omitted]");
  });

  it("forks from an older timeline cursor and refuses a cursor from another epoch", async () => {
    const rows = longSession(300, 40_000);
    const { fetch, epoch } = await storeWith(rows);
    const result = await readAgentForkContext({ fetch, boundaryCursor: { epoch, seq: 450 } });
    expect(result.attachment.text).toContain("[Assistant] Trả lời 150.");
    expect(result.attachment.text).not.toContain("Câu hỏi 151:");
    await expect(
      readAgentForkContext({ fetch, boundaryCursor: { epoch: "old", seq: 450 } }),
    ).rejects.toThrow("Selected timeline position is no longer available.");
    await expect(readAgentForkContext({ fetch, boundaryMessageId: "gone" })).rejects.toThrow(
      "Selected assistant message is no longer available.",
    );
  });

  it("matches the whole-history attachment for a session that fits", async () => {
    const rows = longSession(4, 200);
    const { fetch, epoch } = await storeWith(rows);
    const paged = await readAgentForkContext({
      fetch,
      sourceAgentId: "agent",
      boundaryMessageId: "a3",
    });
    const whole = buildAgentForkContextAttachment({
      rows,
      sourceSession: { agentId: "agent", epoch },
      boundaryMessageId: "a3",
    });
    expect(paged).toEqual(whole);
    expect(paged.attachment.text).not.toContain("omitted");
  });

  it("still refuses a checkpoint whose tool changed after it, across a page edge", async () => {
    const filler = longSession(200, 40_000);
    const turnId = "turn-last";
    const rows = [
      ...filler,
      at(601, { type: "user_message", text: "run it" }, turnId),
      at(
        602,
        {
          type: "tool_call",
          callId: "late",
          name: "terminal",
          status: "running",
          error: null,
          detail: { type: "plain_text", label: "before" },
        } as AgentTimelineItem,
        turnId,
      ),
      at(603, { type: "assistant_message", text: "Partial.", messageId: "partial" }, turnId),
      at(
        604,
        {
          type: "tool_call",
          callId: "late",
          name: "terminal",
          status: "completed",
          error: null,
          detail: { type: "plain_text", label: "after" },
        } as AgentTimelineItem,
        turnId,
      ),
    ];
    const { fetch } = await storeWith(rows);
    await expect(readAgentForkContext({ fetch, boundaryMessageId: "partial" })).rejects.toThrow(
      "Fork from a later completed response",
    );
  });

  it("never shows the tail of a streamed message as if it were the whole message", async () => {
    const turnId = "streamed";
    const chunks = Array.from({ length: 400 }, (_, index) =>
      at(
        index + 2,
        { type: "assistant_message", text: `chunk-${index} ${"x".repeat(30_000)} ` },
        turnId,
      ),
    );
    const rows = [
      at(1, { type: "user_message", text: "write a lot" }, turnId),
      ...chunks,
      at(402, { type: "user_message", text: "and now?" }, "next"),
      at(403, { type: "assistant_message", text: "Done.", messageId: "done" }, "next"),
    ];
    const { fetch } = await storeWith(rows);
    const { text } = (await readAgentForkContext({ fetch })).attachment;
    expectWellFormed(text);
    expect(text).toContain("[Assistant] Done.");
    expect(text).toContain("[Earlier chat history omitted]");
  });

  it("keeps an excerpt of a giant message followed by a short reply instead of dropping it", async () => {
    const giant = `START-MARKER Bắt đầu ${"phân tích 結果 🚀 ".repeat(240_000)} END-MARKER`;
    const { fetch } = await storeWith([
      at(1, { type: "user_message", text: "older question" }, "t0"),
      at(2, { type: "user_message", text: giant }, "t1"),
      at(3, { type: "assistant_message", text: "Done", messageId: "done" }, "t1"),
    ]);
    const { text } = (await readAgentForkContext({ fetch })).attachment;
    expectWellFormed(text);
    expect(Buffer.byteLength(text)).toBeGreaterThan(95_000);
    expect(text).toContain("[Earlier chat history omitted]");
    expect(text).toContain("[User] START-MARKER Bắt đầu");
    expect(text).toContain("[Message truncated]");
    expect(text).toContain("END-MARKER\n[Assistant] Done");
    expect(text).not.toContain("older question");
  });

  it("truncates one oversized multibyte message on character boundaries", async () => {
    const huge = "Bắt đầu. " + "中文🙂".repeat(200_000) + " Kết thúc.";
    const { fetch } = await storeWith([at(1, { type: "assistant_message", text: huge })]);
    const { text } = (await readAgentForkContext({ fetch })).attachment;
    expectWellFormed(text);
    expect(text).toContain("[Assistant] Bắt đầu.");
    expect(text).toContain("[Message truncated]");
    expect(text).toContain("Kết thúc.");
  });
});

function tool(callId: string, status: string) {
  return {
    type: "tool_call",
    callId,
    name: "Bash",
    status,
    error: null,
    detail: { type: "plain_text", label: status },
  } as AgentTimelineItem;
}

const verdict = async (rows: AgentTimelineRow[], boundaryMessageId: string) => {
  const reference = await Promise.resolve()
    .then(() => buildAgentForkContextAttachment({ rows, boundaryMessageId }))
    .then(
      () => "accepted",
      (error: Error) => error.message,
    );
  const { fetch } = await storeWith(rows);
  const paged = await readAgentForkContext({ fetch, boundaryMessageId }).then(
    () => "accepted",
    (error: Error) => error.message,
  );
  return { reference, paged };
};

describe("checkpoint safety matches the whole-history read", () => {
  it("refuses a plugin that changes in a later turn", async () => {
    const plugin = (text: string) =>
      ({ type: "plugin", pluginId: "test", id: "id", data: { text } }) as AgentTimelineItem;
    const result = await verdict(
      [
        at(1, plugin("early"), "one"),
        at(2, { type: "assistant_message", text: "answer", messageId: "anchor" }, "one"),
        at(3, { type: "user_message", text: "question" }, "two"),
        at(4, plugin("late"), "two"),
      ],
      "anchor",
    );
    expect(result.paged).toContain("Fork from a later completed response");
    expect(result.paged).toBe(result.reference);
  });

  it("refuses a tool that completes thousands of same-turn rows later", async () => {
    const rows = [
      at(1, tool("shared", "running"), "turn"),
      at(2, { type: "assistant_message", text: "answer", messageId: "anchor" }, "turn"),
      ...Array.from({ length: 5000 }, (_, index) =>
        at(index + 3, { type: "user_message", text: "filler" }, "turn"),
      ),
      at(5003, tool("shared", "completed"), "turn"),
    ];
    const result = await verdict(rows, "anchor");
    expect(result.paged).toContain("Fork from a later completed response");
    expect(result.paged).toBe(result.reference);
  });

  it("refuses a tool that started in history too old to read and ends after the checkpoint", async () => {
    const filler = longSession(200, 40_000).map((row) => at(row.seq + 1, row.item, "long"));
    const rows = [
      at(1, tool("old", "running"), "long"),
      ...filler,
      at(602, { type: "assistant_message", text: "checkpoint", messageId: "anchor" }, "long"),
      at(603, tool("old", "completed"), "long"),
    ];
    const result = await verdict(rows, "anchor");
    expect(result.paged).toContain("Fork from a later completed response");
    expect(result.paged).toBe(result.reference);
  });

  it("accepts an older checkpoint when later tools are unrelated", async () => {
    const rows = [
      ...longSession(200, 40_000),
      at(601, { type: "user_message", text: "more" }, "later"),
      at(602, tool("new", "running"), "later"),
      at(603, tool("new", "completed"), "later"),
    ];
    const result = await verdict(rows, "a150");
    expect(result).toEqual({ reference: "accepted", paged: "accepted" });
  });
});
