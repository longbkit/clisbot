import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prependAttachmentMentions } from "../src/agents/attachments/prompt.ts";
import { saveWorkspaceAttachment } from "../src/agents/attachments/storage.ts";
import { resolveSlackAttachmentPaths } from "../src/channels/slack/attachments.ts";
import { resolveTelegramAttachmentPaths } from "../src/channels/telegram/attachments.ts";

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

  test("prepends audio attachment paths as normal file mentions", () => {
    expect(prependAttachmentMentions("please transcribe", ["/tmp/voice.oga"])).toBe(
      "@/tmp/voice.oga please transcribe",
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
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-attachments-"));
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
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-attachments-"));
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

  test("maps audio content types to audio extensions", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-attachments-"));
    const filePath = await saveWorkspaceAttachment({
      workspacePath: tempDir,
      sessionKey: "main",
      messageId: "1",
      buffer: Buffer.from("voice"),
      contentType: "audio/ogg",
      defaultBaseName: "telegram-voice",
    });

    expect(filePath.endsWith("telegram-voice.oga")).toBe(true);
  });
});

describe("telegram attachment downloads", () => {
  test("downloads voice messages and preserves an audio extension from Telegram metadata", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-telegram-attachments-"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/getFile")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              file_path: "voice/file-without-extension",
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }

      return new Response(Buffer.from("voice-bytes"), {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
        },
      });
    }) as unknown) as typeof fetch;

    try {
      const paths = await resolveTelegramAttachmentPaths({
        message: {
          message_id: 123,
          chat: {
            id: 456,
            type: "private",
          },
          voice: {
            file_id: "voice-file-id",
            mime_type: "audio/ogg",
          },
        },
        botToken: "telegram-token",
        workspacePath: tempDir,
        sessionKey: "agent-default-telegram-dm-456",
        messageId: "123",
      });

      expect(paths).toHaveLength(1);
      expect(paths[0]?.endsWith("file-without-extension.oga")).toBe(true);
      expect(prependAttachmentMentions("", paths)).toBe(`@${paths[0]}`);
      expect(await Bun.file(paths[0]!).text()).toBe("voice-bytes");
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("slack attachment hydration", () => {
  test("hydrates files from message history when the event payload omits them", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-slack-attachments-"));
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

  test("does not hydrate files from the root thread message for a text-only reply", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-slack-attachments-"));
    const originalFetch = globalThis.fetch;
    let historyCalls = 0;
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
            history: async ({ latest }) => {
              historyCalls += 1;
              if (latest === "1771.2") {
                return {
                  messages: [
                    {
                      ts: "1771.2",
                      files: [],
                    },
                  ],
                };
              }

              return {
                messages: [
                  {
                    ts: "1771.1",
                    files: [
                      {
                        name: "root-thread-image.png",
                        mimetype: "image/png",
                        url_private_download: "https://files.slack.com/root.png",
                      },
                    ],
                  },
                ],
              };
            },
          },
        },
        event: {
          text: "text only reply",
        },
        channelId: "C123",
        messageTs: "1771.2",
        threadTs: "1771.1",
        botToken: "xoxb-test",
        workspacePath: tempDir,
        sessionKey: "agent-default-main",
        messageId: "1771.2",
      });

      expect(paths).toEqual([]);
      expect(historyCalls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
