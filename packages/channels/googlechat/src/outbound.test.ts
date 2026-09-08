// The Hub drive surface against a fake Chat REST endpoint: a real `node:http`
// listener stands in for chat.googleapis.com, reached through the guarded fetch
// seam, so the request bodies below are what Google would actually receive.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { HostRuntime } from "@getpaseo/channels-shared";
import { setGuardedFetchImplementation } from "./fusion/ssrf-fetch.js";

vi.mock("./auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth.js")>()),
  getGoogleChatAccessToken: async () => "test-access-token",
}));

const { deleteMessage, sendMedia, sendText, updateText } = await import("./outbound.js");
const { googlechatChannelActions } = await import("./channel-actions.js");

type Recorded = { method: string; path: string; body: unknown; authorization?: string };

let server: Server;
let baseUrl = "";
const recorded: Recorded[] = [];
let respondWith: (recordedRequest: Recorded) => { status: number; body: unknown } = () => ({
  status: 200,
  body: {},
});

beforeAll(async () => {
  server = createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      raw += chunk;
    });
    request.on("end", () => {
      const entry: Recorded = {
        method: request.method ?? "",
        path: request.url ?? "",
        body: raw === "" ? undefined : JSON.parse(raw),
        ...(request.headers.authorization === undefined
          ? {}
          : { authorization: request.headers.authorization }),
      };
      recorded.push(entry);
      const reply = respondWith(entry);
      response.writeHead(reply.status, { "content-type": "application/json" });
      response.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Point the guarded fetch at the fake endpoint. The vertical keeps building
  // absolute chat.googleapis.com URLs; only the transport is redirected.
  setGuardedFetchImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    return await fetch(url.replace("https://chat.googleapis.com", baseUrl), init);
  });
});

afterAll(async () => {
  setGuardedFetchImplementation(undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  recorded.length = 0;
  respondWith = () => ({ status: 200, body: {} });
});

const SPACE = "spaces/AAAA";

/** Text long enough to render as `chunks` Google Chat messages (32 KB each). */
function longText(chunks: number): string {
  const paragraph = `${"x".repeat(2_000)}\n\n`;
  return paragraph.repeat(Math.ceil((chunks * 32_000) / 2_002) + 2);
}

function driveArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cfg: {
      channels: {
        googlechat: {
          accounts: {
            default: {
              serviceAccount: {
                client_email: "app@example.iam.gserviceaccount.com",
                private_key: "key",
              },
            },
          },
        },
      },
    },
    accountId: "default",
    hostRuntime: {
      state: { openKeyedStore: () => ({}) },
      logging: { getChildLogger: () => ({ warn: () => {} }) },
      channel: {},
      onInboundReply: async () => ({ dispatched: false }),
    } as unknown as HostRuntime,
    to: SPACE,
    ...overrides,
  };
}

describe("sendText", () => {
  it("posts one message per rendered chunk and reports the first message id", async () => {
    let index = 0;
    respondWith = () => ({
      status: 200,
      body: { name: `${SPACE}/messages/M${(index += 1)}`, thread: { name: `${SPACE}/threads/T9` } },
    });
    const result = await sendText(
      driveArgs({ text: "**bold** and a [link](https://example.com)" }) as never,
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.method).toBe("POST");
    expect(recorded[0]?.path).toBe(`/v1/${SPACE}/messages`);
    expect(recorded[0]?.authorization).toBe("Bearer test-access-token");
    // Upstream's renderer owns the wire text: Google Chat bold is `*x*` and a
    // link is `<href|label>`.
    expect(recorded[0]?.body).toMatchObject({
      text: "*bold* and a <https://example.com|link>",
    });
    expect(result.messageId).toBe(`${SPACE}/messages/M1`);
  });

  it("replies into a thread and follows the thread the API actually used", async () => {
    respondWith = () => ({
      status: 200,
      body: { name: `${SPACE}/messages/M1`, thread: { name: `${SPACE}/threads/T1` } },
    });
    await sendText(
      driveArgs({ text: "reply", threadId: `${SPACE}/threads/T1` }) as never,
    );
    expect(recorded[0]?.path).toContain("messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
    expect(recorded[0]?.body).toMatchObject({ thread: { name: `${SPACE}/threads/T1` } });
  });

  it("drops a thread name that belongs to another space instead of failing the send", async () => {
    respondWith = () => ({ status: 200, body: { name: `${SPACE}/messages/M1` } });
    await sendText(
      driveArgs({ text: "reply", threadId: "spaces/OTHER/threads/T1" }) as never,
    );
    // Passing a foreign thread makes the Chat API reject the whole send with
    // 400; upstream drops it so the message still lands in the space.
    expect(recorded[0]?.body).not.toHaveProperty("thread");
    expect(recorded[0]?.path).not.toContain("messageReplyOption");
  });

  it("resolves a users/ target through spaces:findDirectMessage", async () => {
    respondWith = (entry) =>
      entry.path.startsWith("/v1/spaces:findDirectMessage")
        ? { status: 200, body: { name: "spaces/DM1", spaceType: "DIRECT_MESSAGE" } }
        : { status: 200, body: { name: "spaces/DM1/messages/M1" } };
    const result = await sendText(driveArgs({ to: "users/111", text: "hi" }) as never);
    expect(recorded[0]?.path).toContain("spaces:findDirectMessage?name=users%2F111");
    expect(recorded[1]?.path).toBe("/v1/spaces/DM1/messages");
    expect(result.messageId).toBe("spaces/DM1/messages/M1");
  });

  it("keeps a chunked answer in one thread", async () => {
    // Each chunk used to be posted with no thread, so a long answer to a space
    // root arrived as N separate conversations.
    let index = 0;
    respondWith = () => {
      index += 1;
      return {
        status: 200,
        body: { name: `${SPACE}/messages/M${index}`, thread: { name: `${SPACE}/threads/T1` } },
      };
    };
    await sendText(driveArgs({ text: longText(3) }) as never);

    expect(recorded.length).toBeGreaterThan(1);
    expect(recorded[0]?.body).not.toHaveProperty("thread");
    for (const entry of recorded.slice(1)) {
      expect(entry.body).toMatchObject({ thread: { name: `${SPACE}/threads/T1` } });
    }
  });

  it("reports a mid-batch failure as a partial delivery, not a plain failure", async () => {
    // Chunk 1 is already visible: a plain throw makes the Hub retry the whole
    // answer and post it twice.
    let index = 0;
    respondWith = () => {
      index += 1;
      return index === 1
        ? {
            status: 200,
            body: { name: `${SPACE}/messages/M1`, thread: { name: `${SPACE}/threads/T1` } },
          }
        : { status: 500, body: { error: { message: "backend error" } } };
    };

    const failure = await sendText(driveArgs({ text: longText(3) }) as never).catch(
      (error: unknown) => error,
    );

    expect((failure as { sentBeforeError?: boolean }).sentBeforeError).toBe(true);
    expect(
      (failure as { deliveryResult?: { messageIds?: string[] } }).deliveryResult?.messageIds,
    ).toEqual([`${SPACE}/messages/M1`]);
  });

  it("surfaces a Chat API failure as a throw with its status", async () => {
    respondWith = () => ({ status: 403, body: { error: { message: "denied" } } });
    await expect(sendText(driveArgs({ text: "hi" }) as never)).rejects.toThrow(
      /Google Chat API 403/,
    );
  });
});

describe("updateText and deleteMessage", () => {
  it("patches the named message with an explicit update mask", async () => {
    respondWith = () => ({ status: 200, body: { name: `${SPACE}/messages/M1` } });
    await updateText(
      driveArgs({ text: "edited", externalMessageId: `${SPACE}/messages/M1` }) as never,
    );
    expect(recorded[0]?.method).toBe("PATCH");
    expect(recorded[0]?.path).toBe(`/v1/${SPACE}/messages/M1?updateMask=text`);
    expect(recorded[0]?.body).toEqual({ text: "edited" });
  });

  it("patches cardsV2 alongside the text when a card is supplied", async () => {
    respondWith = () => ({ status: 200, body: { name: `${SPACE}/messages/M1` } });
    await updateText(
      driveArgs({
        text: "decided",
        externalMessageId: `${SPACE}/messages/M1`,
        cardsV2: [{ cardId: "c1", card: { header: { title: "Approved" } } }],
      }) as never,
    );
    expect(recorded[0]?.path).toBe(`/v1/${SPACE}/messages/M1?updateMask=text,cardsV2`);
  });

  it("deletes the named message", async () => {
    respondWith = () => ({ status: 200, body: {} });
    await deleteMessage(driveArgs({ externalMessageId: `${SPACE}/messages/M1` }) as never);
    expect(recorded[0]).toMatchObject({ method: "DELETE", path: `/v1/${SPACE}/messages/M1` });
  });
});

describe("sendMedia", () => {
  it("refuses the upload and posts the notice through the text path", async () => {
    respondWith = () => ({ status: 200, body: { name: `${SPACE}/messages/NOTICE` } });
    const result = await sendMedia(
      driveArgs({ filePath: "/tmp/report.pdf" }) as never,
    );
    // Attachment upload is user-OAuth only, so the honest answer is a visible
    // in-channel notice plus mediaPosted:false — never a silent drop.
    expect(result.mediaPosted).toBe(false);
    expect(String((recorded[0]?.body as { text?: string } | undefined)?.text)).toContain(
      "user OAuth",
    );
  });
});

describe("googlechatChannelActions", () => {
  const cfg = driveArgs().cfg as never;

  it("advertises send, edit and delete", () => {
    expect(googlechatChannelActions.describeMessageTool?.({ cfg, accountId: "default" })).toEqual({
      actions: ["send", "edit", "delete"],
    });
    for (const action of ["send", "edit", "delete"] as const) {
      expect(googlechatChannelActions.supportsAction?.({ action, cfg } as never)).toBe(true);
    }
    for (const action of ["react", "upload-file", "pin"] as const) {
      expect(googlechatChannelActions.supportsAction?.({ action, cfg } as never)).toBe(false);
    }
  });

  it("dispatches send through the ported adapter", async () => {
    respondWith = () => ({ status: 200, body: { name: `${SPACE}/messages/M1` } });
    const result = await googlechatChannelActions.handleAction?.({
      action: "send",
      cfg,
      accountId: "default",
      params: { to: SPACE, message: "hello" },
    } as never);
    expect(recorded[0]?.method).toBe("POST");
    expect(JSON.stringify(result)).toContain(`${SPACE}/messages/M1`);
  });

  it("dispatches edit and delete onto the ported REST verbs", async () => {
    respondWith = () => ({ status: 200, body: { name: `${SPACE}/messages/M1` } });
    await googlechatChannelActions.handleAction?.({
      action: "edit",
      cfg,
      accountId: "default",
      params: { messageId: `${SPACE}/messages/M1`, message: "edited" },
    } as never);
    expect(recorded[0]?.method).toBe("PATCH");

    recorded.length = 0;
    await googlechatChannelActions.handleAction?.({
      action: "delete",
      cfg,
      accountId: "default",
      params: { messageId: `${SPACE}/messages/M1` },
    } as never);
    expect(recorded[0]?.method).toBe("DELETE");
  });

  it("refuses an edit whose replacement text needs more than one message", async () => {
    // A Chat edit patches ONE resource. Keeping chunk 1 and answering `ok`
    // silently truncated the agent's text.
    const result = await googlechatChannelActions.handleAction?.({
      action: "edit",
      cfg,
      accountId: "default",
      params: { messageId: `${SPACE}/messages/M1`, message: longText(2) },
    } as never);

    expect(recorded).toHaveLength(0);
    expect(JSON.stringify(result)).toContain("can only rewrite one");
  });

  it("refuses an outbound attachment on send", async () => {
    await expect(
      googlechatChannelActions.handleAction?.({
        action: "send",
        cfg,
        accountId: "default",
        params: { to: SPACE, message: "hi", mediaUrl: "https://example.com/a.png" },
      } as never),
    ).rejects.toThrow(/user OAuth/);
    expect(recorded).toHaveLength(0);
  });

  it("refuses an action outside the supported set", async () => {
    await expect(
      googlechatChannelActions.handleAction?.({
        action: "react",
        cfg,
        accountId: "default",
        params: { messageId: `${SPACE}/messages/M1`, emoji: "+1" },
      } as never),
    ).rejects.toThrow(/not supported/);
  });
});
