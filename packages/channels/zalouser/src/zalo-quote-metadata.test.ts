// upstream: extensions/zalouser/src/zalo-quote-metadata.test.ts@5d8067a4483
// D-ZU-004/D-ZU-009: the harness moves with the boundaries. Upstream drives the
// OpenClaw plugin-state test runtime through `setZalouserRuntime` + a temp
// `OPENCLAW_STATE_DIR`; Fusion installs an in-memory `ZalouserSessionStore`. The
// media-cap case calls the carried `sendZalouserMediaFromContext` directly,
// because upstream's `zalouserMessageAdapter` wrapper is dropped with the
// OpenClaw delivery pipeline. Every assertion is unchanged.
// Zalouser tests cover inbound normalization and outbound bounds through public plugin paths.
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { API, Message } from "./zca-client.js";

const createZaloMock = vi.hoisted(() => vi.fn());
let sessionSequence = 0;

vi.mock("./zca-client.js", () => ({
  createZalo: createZaloMock,
  TextStyle: { Indent: 9 },
}));

import { sendZalouserMediaFromContext } from "./channel.adapters.js";
import {
  createMemorySessionStore,
  hydrateZalouserSessions,
  installZalouserSessionStore,
} from "./fusion/session-store.js";

/** One account per test file; the store registry is keyed by account. */
const TEST_ACCOUNT = "acct-test";
import { saveStoredZaloCredentials } from "./session-state.js";
import {
  normalizeZaloInboundMessage,
  resolveZaloGroupContext,
  sendZaloTextMessage,
  startZaloListener,
} from "./zalo-js.js";

type ListenerOn = ReturnType<typeof vi.fn>;

function createMockApi(overrides: Partial<API> = {}): API {
  return {
    getContext: () => ({ imei: "test-imei", userAgent: "test-agent", language: "en" }),
    getCookie: () => ({ toJSON: () => ({ cookies: [{ key: "zpsid", value: "test" }] }) }),
    fetchAccountInfo: async () => ({
      userId: "555444333",
      username: "owner",
      displayName: "Owner",
      zaloName: "Owner",
      avatar: "",
    }),
    listener: {
      on: vi.fn(),
      off: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    },
    ...overrides,
  } as unknown as API;
}

async function withStoredSession<T>(params: {
  profile: string;
  api: API;
  run: () => Promise<T>;
}): Promise<T> {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-zalouser-message-"));
  saveStoredZaloCredentials(
    params.profile,
    {
      imei: "test-imei",
      cookie: [{ key: "zpsid", value: "test" }],
      userAgent: "test-agent",
      createdAt: new Date().toISOString(),
    },
    { OPENCLAW_STATE_DIR: stateDir },
  );
  createZaloMock.mockResolvedValueOnce({ login: vi.fn(async () => params.api) });
  try {
    return await params.run();
  } finally {
    installZalouserSessionStore(TEST_ACCOUNT, undefined);
    await rm(stateDir, { recursive: true, force: true });
  }
}

function findListener(listenerOn: ListenerOn, event: string): (message: Message) => void {
  const callback = listenerOn.mock.calls.find(([name]) => name === event)?.[1];
  if (typeof callback !== "function") {
    throw new Error(`Missing ${event} listener`);
  }
  return callback as (message: Message) => void;
}

function createInboundMessage(data: Record<string, unknown>): Message {
  return {
    type: 0,
    threadId: "123456789",
    isSelf: false,
    data: {
      uidFrom: "123456789",
      idTo: "987654321",
      content: "plain message",
      ...data,
    },
  };
}

beforeEach(async () => {
  installZalouserSessionStore(TEST_ACCOUNT, createMemorySessionStore());
  await hydrateZalouserSessions(TEST_ACCOUNT);
  createZaloMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Zalo payload bounds", () => {
  it("applies the resolved account media cap before the native message send", async () => {
    const sendMessage = vi.fn(async () => ({ msgId: "media-cap" }));
    const api = createMockApi({ sendMessage } as Partial<API>);
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "zalouser-media-cap-")));
    const file = path.join(directory, "attachment.txt");
    try {
      await withStoredSession({
        profile: "media-cap",
        api,
        run: async () => {
          const sendMedia = sendZalouserMediaFromContext;
          if (!sendMedia) {
            throw new Error("Zalo Personal media sender unavailable");
          }
          const params = {
            cfg: {
              channels: {
                zalouser: {
                  mediaMaxMb: 10,
                  accounts: { Limited: { profile: "media-cap", mediaMaxMb: 1 / 1024 } },
                },
              },
            },
            accountId: "limited",
            to: "user:123456789",
            text: "attachment",
            mediaUrl: file,
            mediaLocalRoots: [directory],
          };
          await writeFile(file, "x".repeat(1536));
          // D-ZU-024: the refusal MESSAGE is the core outbound-media boundary's
          // ("… is N bytes, over the M byte limit"); upstream's is "exceeds
          // limit". The invariant the case exists for — the cap is applied
          // BEFORE the native send, so nothing is posted — is unchanged.
          await expect(sendMedia(params)).rejects.toThrow(/over the \d+ byte limit/i);
          expect(sendMessage).not.toHaveBeenCalled();
          await writeFile(file, "x".repeat(512));
          const result = await sendMedia(params);
          expect(result.messageId).toBe("media-cap");
          expect(sendMessage).toHaveBeenCalledOnce();
          expect(sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              attachments: [expect.objectContaining({ data: Buffer.from("x".repeat(512)) })],
            }),
            "123456789",
            expect.anything(),
          );
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the 2,000-code-unit transport payload UTF-16 well-formed", async () => {
    const sendMessage = vi.fn(async () => ({ msgId: "message-1" }));
    const api = createMockApi({ sendMessage } as Partial<API>);

    await withStoredSession({
      profile: "payload-bounds",
      api,
      run: async () => {
        await expect(
          sendZaloTextMessage("thread-1", `${"x".repeat(1_999)}🚀tail`, {
            profile: "payload-bounds",
          }),
        ).resolves.toMatchObject({ ok: true });
      },
    });

    expect(sendMessage).toHaveBeenCalledWith("x".repeat(1_999), "thread-1", expect.anything());
  });
});

describe("Zalo inbound normalization", () => {
  async function captureInbound(messages: Message[]): Promise<Array<Record<string, unknown>>> {
    const profile = `listener-${sessionSequence++}`;
    const listenerOn = vi.fn();
    const api = createMockApi({
      listener: {
        on: listenerOn,
        off: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      },
    } as Partial<API>);
    const received: Message[] = [];

    await withStoredSession({
      profile,
      api,
      run: async () => {
        const abortController = new AbortController();
        const listener = await startZaloListener({
          accountId: "default",
          profile,
          abortSignal: abortController.signal,
          onMessage: (message) => {
            received.push(message);
          },
          onError: vi.fn(),
        });
        const onMessage = findListener(listenerOn, "message");
        for (const message of messages) {
          onMessage(message);
        }
        listener.stop();
      },
    });

    return received
      .map((message) => normalizeZaloInboundMessage(message, "555444333"))
      .filter((message): message is NonNullable<typeof message> => message !== null)
      .map((message) => message as unknown as Record<string, unknown>);
  }

  it("extracts quote metadata and implicit mentions", async () => {
    const [message] = await captureInbound([
      createInboundMessage({
        content: "ok",
        ts: 1_764_000_000_000,
        quote: {
          globalMsgId: 987654321234,
          ownerId: "555444333_2",
          msg: "Previous bot message content",
        },
      }),
    ]);

    expect(message).toMatchObject({
      quotedGlobalMsgId: "987654321234",
      quotedOwnerId: "555444333",
      quotedBody: "Previous bot message content",
      implicitMention: true,
    });
  });

  it("omits absent quote metadata", async () => {
    const [message] = await captureInbound([createInboundMessage({ ts: 1_764_000_000_000 })]);

    expect(message?.quotedGlobalMsgId).toBeUndefined();
    expect(message?.quotedOwnerId).toBeUndefined();
    expect(message?.quotedBody).toBeUndefined();
  });

  it("normalizes second and millisecond timestamps", async () => {
    const messages = await captureInbound([
      createInboundMessage({ ts: 1_764_000_000 }),
      createInboundMessage({ ts: "1764000000.5" }),
      createInboundMessage({ ts: 1_764_000_000_000 }),
    ]);

    expect(messages.map((message) => message.timestampMs)).toEqual([
      1_764_000_000_000, 1_764_000_000_500, 1_764_000_000_000,
    ]);
  });

  it("falls back for partial or unsafe timestamps", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const messages = await captureInbound([
      createInboundMessage({ ts: "1764000000abc" }),
      createInboundMessage({ ts: "9007199254740993" }),
      createInboundMessage({ ts: 8_640_000_000_000_001 }),
    ]);

    expect(messages.map((message) => message.timestampMs)).toEqual([
      1_700_000_000_000, 1_700_000_000_000, 1_700_000_000_000,
    ]);
  });
});

describe("Zalo group context cache", () => {
  function createGroupApi(getGroupInfo: ReturnType<typeof vi.fn>): API {
    return createMockApi({ getGroupInfo } as Partial<API>);
  }

  it("refetches group context when the current clock is invalid", async () => {
    const getGroupInfo = vi.fn(async () => ({
      gridInfoMap: { "group-invalid-clock": { groupId: "group-invalid-clock", name: "Group" } },
    }));
    const api = createGroupApi(getGroupInfo);

    await withStoredSession({
      profile: "cache-invalid-clock",
      api,
      run: async () => {
        await resolveZaloGroupContext("cache-invalid-clock", "group-invalid-clock");
        vi.spyOn(Date, "now").mockReturnValue(Number.NaN);
        await resolveZaloGroupContext("cache-invalid-clock", "group-invalid-clock");
      },
    });

    expect(getGroupInfo).toHaveBeenCalledTimes(2);
  });

  it("does not cache group context when ttl expiry exceeds the Date range", async () => {
    const getGroupInfo = vi.fn(async () => ({
      gridInfoMap: { "group-overflow": { groupId: "group-overflow", name: "Overflow" } },
    }));
    const api = createGroupApi(getGroupInfo);
    vi.spyOn(Date, "now").mockReturnValue(8_640_000_000_000_000);

    await withStoredSession({
      profile: "cache-overflow",
      api,
      run: async () => {
        await resolveZaloGroupContext("cache-overflow", "group-overflow");
        await resolveZaloGroupContext("cache-overflow", "group-overflow");
      },
    });

    expect(getGroupInfo).toHaveBeenCalledTimes(2);
  });
});
