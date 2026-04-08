import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prependAttachmentMentions } from "../src/agents/attachments/prompt.ts";
import { saveWorkspaceAttachment } from "../src/agents/attachments/storage.ts";
import { resolveSlackAttachmentPaths } from "../src/channels/slack/attachments.ts";

describe("attachment prompt shaping", () => {
  test("prepends attachment mentions before normal text", () => {
    expect(
      prependAttachmentMentions("please review", ["/tmp/a.md", "/tmp/b.png"]),
    ).toBe("@/tmp/a.md @/tmp/b.png please review");
  });

  test("returns attachment mentions for file-only prompts", () => {
    expect(prependAttachmentMentions("", ["/tmp/a.md"])).toBe("@/tmp/a.md");
  });

  test("does not prepend attachment mentions to slash commands", () => {
    expect(prependAttachmentMentions("/transcript", ["/tmp/a.md"])).toBe(
      "/transcript",
    );
  });
});

describe("workspace attachment storage", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("stores attachments under the workspace .attachments tree", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "muxbot-attachments-"));
    const filePath = await saveWorkspaceAttachment({
      workspacePath: tempDir,
      sessionKey: "agent:default:slack:channel:C123:thread:1",
      messageId: "1771.22",
      buffer: Buffer.from("hello"),
      originalFilename: "spec.md",
      contentType: "text/markdown",
      defaultBaseName: "attachment",
    });

    expect(filePath.startsWith(join(tempDir, ".attachments"))).toBe(true);
    expect(filePath.endsWith("spec.md")).toBe(true);
    expect(await Bun.file(filePath).text()).toBe("hello");
  });

  test("sanitizes missing or unsafe names and preserves uniqueness", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "muxbot-attachments-"));
    const first = await saveWorkspaceAttachment({
      workspacePath: tempDir,
      sessionKey: "main",
      messageId: "1",
      buffer: Buffer.from("one"),
      originalFilename: " spec plan ?.md ",
      contentType: "text/markdown",
      defaultBaseName: "attachment",
    });
    const second = await saveWorkspaceAttachment({
      workspacePath: tempDir,
      sessionKey: "main",
      messageId: "1",
      buffer: Buffer.from("two"),
      originalFilename: " spec plan ?.md ",
      contentType: "text/markdown",
      defaultBaseName: "attachment",
    });

    expect(first.endsWith("spec-plan.md")).toBe(true);
    expect(second.endsWith("spec-plan-2.md")).toBe(true);
  });
});

describe("slack attachment hydration", () => {
  test("hydrates files from message history when the event payload omits them", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "muxbot-slack-attachments-"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((async () =>
      new Response(Buffer.from("hello from slack"), {
        status: 200,
        headers: {
          "content-type": "text/plain",
        },
      })) as unknown) as typeof fetch;

    try {
      const paths = await resolveSlackAttachmentPaths({
        client: {
          conversations: {
            history: async () => ({
              messages: [
                {
                  ts: "1771.1",
                  files: [
                    {
                      name: "hydrated.txt",
                      mimetype: "text/plain",
                      url_private_download: "https://files.slack.com/test.txt",
                    },
                  ],
                },
              ],
            }),
          },
        },
        event: {
          text: "please check file",
        },
        channelId: "C123",
        messageTs: "1771.1",
        threadTs: "1771.1",
        botToken: "xoxb-test",
        workspacePath: tempDir,
        sessionKey: "agent-default-main",
        messageId: "1771.1",
      });

      expect(paths).toHaveLength(1);
      expect(paths[0]?.includes("/.attachments/")).toBe(true);
      expect(await Bun.file(paths[0]!).text()).toBe("hello from slack");
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
