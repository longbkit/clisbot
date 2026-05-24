import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prependAttachmentMentionsToPrompt } from "../../src/agents/attachments/prompt.ts";
import {
  resolveZaloPersonalAttachmentPaths,
  resolveZaloPersonalAttachmentUrls,
  resolveZaloPersonalMediaGroup,
} from "../../src/channels/zalo-personal/attachments.ts";
import {
  getZaloPersonalMessageId,
  getZaloPersonalMessageText,
} from "../../src/channels/zalo-personal/inbound-message.ts";
import type { ZaloPersonalInboundMessage } from "../../src/channels/zalo-personal/service-types.ts";

function buildMessage(overrides: Partial<ZaloPersonalInboundMessage["data"]>): ZaloPersonalInboundMessage {
  return {
    type: 0,
    threadId: "user-1",
    isSelf: false,
    data: {
      msgId: "msg-1",
      cliMsgId: "",
      msgType: "chat.photo",
      uidFrom: "user-1",
      idTo: "bot-1",
      ts: "1",
      content: "",
      ...overrides,
    },
  } as ZaloPersonalInboundMessage;
}

describe("zalo-personal attachment downloads", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("downloads inbound photo content into workspace attachments and keeps the caption", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-zalo-personal-attachments-"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((async () =>
      new Response(Buffer.from("zalo-photo"), {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
        },
      })) as unknown) as typeof fetch;

    try {
      const message = buildMessage({
        content: {
          title: "doc duoc ko",
          description: "",
          href: "https://photo-stal-24.zdn.vn/no/jpg/photo-without-extension",
        },
      });
      const paths = await resolveZaloPersonalAttachmentPaths({
        message,
        workspacePath: tempDir,
        sessionKey: "agent-default-zalo-personal-dm-user-1",
        messageId: "zalo-personal:default:msg-1",
      });

      expect(resolveZaloPersonalAttachmentUrls(message)).toEqual([
        "https://photo-stal-24.zdn.vn/no/jpg/photo-without-extension",
      ]);
      expect(paths).toHaveLength(1);
      expect(paths[0]).toContain("/.attachments/");
      expect(paths[0]?.endsWith("photo-without-extension.jpg")).toBe(true);
      expect(await Bun.file(paths[0]!).text()).toBe("zalo-photo");
      expect(getZaloPersonalMessageText(message, "bot-1")).toBe("doc duoc ko");
      expect(prependAttachmentMentionsToPrompt(getZaloPersonalMessageText(message, "bot-1"), paths))
        .toBe(`@${paths[0]} doc duoc ko`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not treat normal link previews as downloadable attachments", () => {
    const message = buildMessage({
      msgType: "chat.link",
      content: {
        title: "Example Domain",
        description: "link preview",
        href: "https://example.com",
      },
    });

    expect(resolveZaloPersonalAttachmentUrls(message)).toEqual([]);
    expect(getZaloPersonalMessageText(message, "bot-1")).toBe(
      "Example Domain link preview https://example.com",
    );
  });

  test("extracts inbound image album metadata from content params", () => {
    const message = buildMessage({
      content: {
        title: "second image",
        href: "https://photo-stal-24.zdn.vn/no/jpg/photo.jpg",
        params: JSON.stringify({
          rawUrl: "https://photo-stal-24.zdn.vn/no/jpg/photo.jpg",
          id_in_group: 1,
          is_group_layout: 1,
          group_layout_id: 1779587704613,
          total_item_in_group: 2,
        }),
      },
    });

    expect(resolveZaloPersonalMediaGroup(message)).toEqual({
      groupLayoutId: "1779587704613",
      idInGroup: 1,
      totalItemInGroup: 2,
    });
  });

  test("reads grouped image attachments and captions as one inbound message", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-zalo-personal-grouped-"));
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = ((async () =>
      new Response(Buffer.from(`zalo-photo-${++fetchCount}`), {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
        },
      })) as unknown) as typeof fetch;

    try {
      const first = buildMessage({
        msgId: "msg-1",
        content: {
          title: "caption one",
          href: "https://photo-stal-24.zdn.vn/no/jpg/photo-a",
          params: JSON.stringify({
            id_in_group: 0,
            group_layout_id: 1779587704613,
            total_item_in_group: 2,
          }),
        },
      });
      const second = buildMessage({
        msgId: "msg-2",
        content: {
          title: "caption two",
          href: "https://photo-stal-24.zdn.vn/no/jpg/photo-b",
          params: JSON.stringify({
            id_in_group: 1,
            group_layout_id: 1779587704613,
            total_item_in_group: 2,
          }),
        },
      });
      const grouped = {
        ...first,
        mediaGroupMessages: [first, second],
      };

      expect(resolveZaloPersonalAttachmentUrls(grouped)).toEqual([
        "https://photo-stal-24.zdn.vn/no/jpg/photo-a",
        "https://photo-stal-24.zdn.vn/no/jpg/photo-b",
      ]);
      expect(getZaloPersonalMessageText(grouped, "bot-1")).toBe("caption one\ncaption two");
      expect(getZaloPersonalMessageId(grouped)).toBe("media-group:1779587704613:msg-1,msg-2");

      const paths = await resolveZaloPersonalAttachmentPaths({
        message: grouped,
        workspacePath: tempDir,
        sessionKey: "agent-default-zalo-personal-dm-user-1",
        messageId: "zalo-personal:default:media-group",
      });

      expect(paths).toHaveLength(2);
      expect(await Bun.file(paths[0]!).text()).toBe("zalo-photo-1");
      expect(await Bun.file(paths[1]!).text()).toBe("zalo-photo-2");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
