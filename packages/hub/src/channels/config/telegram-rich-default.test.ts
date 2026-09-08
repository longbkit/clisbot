// The Fusion Telegram rendering default, end to end over the seam it has to
// survive: authored account YAML → `compileAccountConfig` → the supervisor's
// drive-time carriers → the REAL telegram vertical's `sendText`. A default that
// compiles but does not reach `account.config.richMessages` in the vertical is
// the failure this pins; the vertical is imported from its build output for the
// same reason `account-carriers.test.ts` does (`npm run build --workspace=…`).
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "vitest";
import { sendText } from "@getpaseo/channels-telegram/dist/outbound.js";
import { setChannelHostRuntime } from "@getpaseo/channels-telegram/dist/runtime-store.js";
import { compileChannelControlPlane } from "./compile.js";
import { buildAccountCarriers } from "../supervisor/account-carriers.js";

const ACCOUNT_ID = "bot";

/** The markdown showcase wave 5 drives live (p0-live-scenarios.md). */
const MARKDOWN_SHOWCASE = [
  "# Heading one",
  "",
  "**bold** and *italic*",
  "",
  "- bullet one",
  "- bullet two",
  "",
  "> quoted line",
  "",
  "```js",
  "const x = 1;",
  "```",
  "",
  "| A | B | C |",
  "| --- | --- | --- |",
  "| 1 | 2 | 3 |",
  "",
].join("\n");

function accountFile(config: string): string {
  return `
channel: telegram
accountId: ${ACCOUNT_ID}
connectionId: telegram-main
transport: { mode: polling }
${config}
`;
}

function compileTelegramConfig(config: string): Record<string, unknown> {
  const plane = compileChannelControlPlane({
    files: [{ path: `.paseo/channels/telegram/${ACCOUNT_ID}.yml`, content: accountFile(config) }],
    agentNames: ["assistant"],
    environmentNames: ["repo"],
    workflowNames: [],
  });
  return plane.accounts[0]!.config;
}

interface ApiCall {
  method: string;
  args: unknown[];
}

function fakeApi(calls: ApiCall[]): Record<string, unknown> {
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return { message_id: calls.length, chat: { id: -100200300, type: "supergroup" } };
    };
  return {
    sendMessage: record("sendMessage"),
    getChat: async () => ({ id: -100200300, type: "supergroup" }),
    raw: { sendRichMessage: record("sendRichMessage") },
  } as unknown as Record<string, unknown>;
}

/** Compile the authored config, hand it through the supervisor's carriers, and
 * post the showcase with the vertical's own outbound entry point. */
async function driveShowcase(config: string): Promise<ApiCall[]> {
  const compiled = compileChannelControlPlane({
    files: [{ path: `.paseo/channels/telegram/${ACCOUNT_ID}.yml`, content: accountFile(config) }],
    agentNames: ["assistant"],
    environmentNames: ["repo"],
    workflowNames: [],
  }).accounts[0]!;
  const carriers = buildAccountCarriers("telegram", {
    accountId: ACCOUNT_ID,
    compiled,
    botToken: "123456:telegram-token",
  });
  const cfg = {
    channels: { telegram: { accounts: { [ACCOUNT_ID]: carriers.cfgAccount } } },
  } as unknown as Record<string, unknown>;
  const calls: ApiCall[] = [];
  await sendText({
    cfg,
    accountId: ACCOUNT_ID,
    to: "-100200300",
    text: MARKDOWN_SHOWCASE,
    api: fakeApi(calls),
  });
  return calls;
}

beforeEach(() => {
  setChannelHostRuntime({
    state: { openKeyedStore: () => memoryKeyedStore() },
    logging: { getChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) },
  } as never);
});

function memoryKeyedStore() {
  const map = new Map<string, unknown>();
  return {
    register: async (key: string, value: unknown) => void map.set(key, value),
    registerIfAbsent: async (key: string, value: unknown) =>
      map.has(key) ? false : (map.set(key, value), true),
    update: async (key: string, updateValue: (previous: unknown) => unknown) => {
      const next = updateValue(map.get(key));
      if (next === undefined) return false;
      map.set(key, next);
      return true;
    },
    lookup: async (key: string) => map.get(key),
    consume: async (key: string) => {
      const value = map.get(key);
      map.delete(key);
      return value;
    },
    delete: async (key: string) => map.delete(key),
    entries: async () => [...map].map(([key, value]) => ({ key, value, createdAt: Date.now() })),
    clear: async () => map.clear(),
  };
}

describe("Telegram richMessages default", () => {
  it("fills an absent richMessages on a Telegram account", () => {
    assert.deepEqual(compileTelegramConfig(""), { richMessages: true });
    assert.deepEqual(compileTelegramConfig("config: { timeoutSeconds: 90 }"), {
      timeoutSeconds: 90,
      richMessages: true,
    });
  });

  it("leaves an authored richMessages alone, either way", () => {
    assert.deepEqual(compileTelegramConfig("config: { richMessages: false }"), {
      richMessages: false,
    });
    assert.deepEqual(compileTelegramConfig("config: { richMessages: true }"), {
      richMessages: true,
    });
  });

  it("touches no other channel's config block", () => {
    const plane = compileChannelControlPlane({
      files: [
        {
          path: ".paseo/channels/slack/work.yml",
          content: `
channel: slack
accountId: work
connectionId: slack-work
transport: { mode: socket }
config: { timeoutSeconds: 90 }
`,
        },
      ],
      agentNames: ["assistant"],
      environmentNames: ["repo"],
      workflowNames: [],
    });
    assert.deepEqual(plane.accounts[0]!.config, { timeoutSeconds: 90 });
  });

  it("renders the showcase as native rich blocks with no authored config", async () => {
    const calls = await driveShowcase("");
    assert.deepEqual(
      calls.map((call) => call.method),
      ["sendRichMessage"],
    );
    const params = (calls[0]!.args.at(-1) ?? {}) as {
      rich_message?: { blocks?: Array<Record<string, unknown>> };
    };
    const blocks = params.rich_message?.blocks ?? [];
    assert.deepEqual(
      blocks.map((block) => block["type"]),
      ["heading", "paragraph", "list", "blockquote", "pre", "table"],
    );
    assert.equal(blocks[0]!["text"], "Heading one");
    const table = blocks.at(-1) as { cells?: Array<Array<Record<string, unknown>>> };
    assert.deepEqual(
      table.cells?.[0]?.map((cell) => cell["text"]),
      ["A", "B", "C"],
    );
  });

  it("still posts the flat HTML path when the author opts out", async () => {
    const calls = await driveShowcase("config: { richMessages: false }");
    assert.deepEqual(
      calls.map((call) => call.method),
      ["sendMessage"],
    );
    // Upstream's HTML path has no heading tag; the heading flattens to text.
    assert.match(String(calls[0]!.args[1]), /^Heading one/u);
  });
});
