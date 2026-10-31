import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  REASONING_MAX_BYTES,
  TAIL_MAX_BYTES,
  compactTailItem,
  keepNewestWithinBytes,
} from "./timeline-tail";

const timestamp = new Date("2026-10-30T08:00:00.000Z");
const cursor = { epoch: "epoch-1", seq: 7 };

function shellCall(output: string): StreamItem {
  return {
    kind: "tool_call",
    id: "tool-1",
    timestamp,
    timelineCursor: cursor,
    payload: {
      source: "agent",
      data: {
        provider: "codex",
        callId: "call-1",
        name: "Bash",
        status: "completed",
        error: null,
        detail: { type: "shell", command: "npm run lint\n  -- src/a.ts", output, exitCode: 0 },
        metadata: { stdoutBytes: output.length },
      },
    },
  };
}

describe("compactTailItem", () => {
  it("keeps only the tool call's id, name, status and a one-line title", () => {
    const compacted = compactTailItem(shellCall("x".repeat(50_000)));

    expect(compacted).toEqual({
      kind: "tool_call",
      id: "tool-1",
      timestamp,
      timelineCursor: cursor,
      payload: {
        source: "agent",
        data: {
          provider: "codex",
          callId: "call-1",
          name: "Bash",
          status: "completed",
          error: null,
          detail: { type: "plain_text", label: "npm run lint -- src/a.ts" },
        },
      },
    });
  });

  it("reduces a failed call's error to one bounded line", () => {
    const failed = shellCall("");
    if (failed.kind !== "tool_call" || failed.payload.source !== "agent") throw new Error("shape");
    failed.payload.data = {
      ...failed.payload.data,
      status: "failed",
      error: { message: `boom\n${"stack ".repeat(500)}` },
    };

    const compacted = compactTailItem(failed);

    if (compacted.kind !== "tool_call" || compacted.payload.source !== "agent")
      throw new Error("shape");
    expect(compacted.payload.data.status).toBe("failed");
    expect(typeof compacted.payload.data.error).toBe("string");
    expect(String(compacted.payload.data.error)).not.toContain("\n");
    expect(String(compacted.payload.data.error).length).toBeLessThanOrEqual(160);
  });

  it("truncates reasoning to 2 KB and leaves short reasoning untouched", () => {
    const short: StreamItem = {
      kind: "thought",
      id: "thought-1",
      timestamp,
      text: "short",
      status: "ready",
    };
    const long: StreamItem = { ...short, text: "é".repeat(REASONING_MAX_BYTES) };

    expect(compactTailItem(short)).toBe(short);
    const truncated = compactTailItem(long);
    if (truncated.kind !== "thought") throw new Error("shape");
    expect(new TextEncoder().encode(truncated.text).byteLength).toBeLessThanOrEqual(
      REASONING_MAX_BYTES,
    );
    expect(truncated.text.startsWith("éé")).toBe(true);
  });

  it("keeps user and assistant text but drops images and attachments", () => {
    const assistant: StreamItem = {
      kind: "assistant_message",
      id: "a-1",
      timestamp,
      text: "y".repeat(100_000),
    };
    const user: StreamItem = {
      kind: "user_message",
      id: "u-1",
      timestamp,
      text: "see image",
      images: [
        {
          id: "img",
          mimeType: "image/png",
          storageType: "native-file",
          storageKey: "/tmp/img.png",
          createdAt: 0,
        },
      ],
    };

    expect(compactTailItem(assistant)).toBe(assistant);
    const compactUser = compactTailItem(user);
    expect(compactUser).not.toBe(user);
    expect(compactUser).toEqual({ kind: "user_message", id: "u-1", timestamp, text: "see image" });
  });
});

describe("keepNewestWithinBytes", () => {
  it("keeps the newest items whose total size stays within the cap", () => {
    const items = ["aaaa", "bbbb", "cccc"];

    expect(keepNewestWithinBytes(items, (item) => item.length, 8)).toEqual(["bbbb", "cccc"]);
    expect(keepNewestWithinBytes(items, (item) => item.length, 3)).toEqual([]);
    expect(TAIL_MAX_BYTES).toBe(256 * 1024);
  });
});
