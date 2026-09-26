import { describe, expect, test } from "vitest";
import { CHAT_RULE_DEFAULTS, resolveChatRules, type ResolvedChatRules } from "./chat-record.js";
import { inputLimitError, targetsFor, type TurnRuleInput } from "./turn-rules.js";

const group = [
  { botId: "bot_a", slug: "alpha" },
  { botId: "bot_b", slug: "beta" },
  { botId: "bot_c", slug: "gamma" },
];
const names: Record<string, string> = { bot_a: "Alpha", bot_b: "Beta", bot_c: "Gamma" };

function decide(
  line: TurnRuleInput["line"],
  overrides: Partial<Pick<TurnRuleInput, "participants" | "rules">> = {},
) {
  return targetsFor({
    participants: group,
    rules: CHAT_RULE_DEFAULTS,
    botName: (botId) => names[botId] ?? botId,
    ...overrides,
    line,
  });
}

const user = (text: string) => ({ sender: { kind: "user" as const }, text, hop: 0 });
const bot = (botId: string, text: string, hop: number) => ({
  sender: { kind: "bot" as const, botId },
  text,
  hop,
});
const mentionRequired: ResolvedChatRules = resolveChatRules({
  interaction: { requireMention: true },
});

describe("targetsFor — the §2.2 table", () => {
  test("a user line with no mention goes to every participant unless a mention is required", () => {
    expect(decide(user("status?"))).toEqual({ targets: ["bot_a", "bot_b", "bot_c"] });
    expect(decide(user("status?"), { rules: mentionRequired })).toEqual({ targets: [] });
  });

  test("a user line that mentions A and B goes to A and B under either rule", () => {
    const expected = { targets: ["bot_a", "bot_b"] };
    expect(decide(user("@alpha @beta go"))).toEqual(expected);
    expect(decide(user("@alpha @beta go"), { rules: mentionRequired })).toEqual(expected);
  });

  test("a bot reply mentioning B within the hop limit goes to B only", () => {
    expect(decide(bot("bot_a", "@beta check this, @gamma later", 1))).toEqual({
      targets: ["bot_b", "bot_c"],
    });
    expect(decide(bot("bot_a", "@beta check this", 3))).toEqual({ targets: ["bot_b"] });
    expect(decide(bot("bot_a", "@beta check", 1), { rules: mentionRequired })).toEqual({
      targets: ["bot_b"],
    });
  });

  test("a bot reply with no mention, or mentioning only itself, reaches nobody", () => {
    expect(decide(bot("bot_a", "all done", 1))).toEqual({ targets: [] });
    expect(decide(bot("bot_a", "as @alpha I say: done", 1))).toEqual({ targets: [] });
  });

  test("a bot reply past the hop limit ends in a system notice", () => {
    expect(decide(bot("bot_c", "@alpha your turn", 4))).toEqual({
      targets: [],
      notice:
        "⚠️ Gamma mentioned @alpha, but the hop limit (3) was reached; nothing was forwarded.",
    });
    expect(
      decide(bot("bot_c", "@alpha go", 1), { rules: resolveChatRules({ hops: { max: 0 } }) }),
    ).toEqual({
      targets: [],
      notice:
        "⚠️ Gamma mentioned @alpha, but the hop limit (0) was reached; nothing was forwarded.",
    });
  });

  test("a direct chat delivers every user line to its one bot, mention or not", () => {
    const direct = [group[0]!];
    expect(decide(user("hi"), { participants: direct })).toEqual({ targets: ["bot_a"] });
    expect(decide(user("hi"), { participants: direct, rules: mentionRequired })).toEqual({
      targets: ["bot_a"],
    });
    expect(decide(bot("bot_a", "answer", 1), { participants: direct })).toEqual({ targets: [] });
  });

  test("a system line reaches nobody", () => {
    expect(decide({ sender: { kind: "system" }, text: "@alpha ⚠️ notice", hop: 0 })).toEqual({
      targets: [],
    });
  });
});

describe("inputLimitError", () => {
  test("refuses text over maxInputCharacters and accepts `off`", () => {
    expect(inputLimitError(CHAT_RULE_DEFAULTS, "x".repeat(8000))).toBeNull();
    expect(inputLimitError(CHAT_RULE_DEFAULTS, "x".repeat(8001))).toBe(
      "Message is 8001 characters; this chat accepts at most 8000.",
    );
    const off = resolveChatRules({ limits: { maxInputCharacters: "off" } });
    expect(inputLimitError(off, "x".repeat(20_000))).toBeNull();
    const tight = resolveChatRules({ limits: { maxInputCharacters: 3 } });
    expect(inputLimitError(tight, "four")).toBe(
      "Message is 4 characters; this chat accepts at most 3.",
    );
  });
});
