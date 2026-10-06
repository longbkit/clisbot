import { describe, expect, it } from "vitest";
import { matchReaction, normalizeReactionEmoji, planReactionCard, reactionLegend } from "./reaction-cards.js";

const permission = [
  { text: "Approve", value: "allow:c1", style: "primary" as const },
  { text: "Deny", value: "deny:c1", style: "danger" as const },
];

describe("fusion reaction cards", () => {
  it("maps an approval to 👍 / 👎", () => {
    expect(planReactionCard(permission)).toEqual([
      { emoji: "👍", label: "Approve", value: "allow:c1" },
      { emoji: "👎", label: "Deny", value: "deny:c1" },
    ]);
  });

  it("maps up to four question options to 1️⃣–4️⃣, skips Other, keeps Dismiss", () => {
    const plan = planReactionCard([
      { text: "Pho", value: "allow:q:Pho" },
      { text: "Bun", value: "allow:q:Bun" },
      { text: "Other…", value: "allow:q:Other" },
      { text: "Dismiss", value: "deny:q", style: "danger" },
    ]);
    expect(plan?.map((choice) => `${choice.emoji}=${choice.value}`)).toEqual(["1️⃣=allow:q:Pho", "2️⃣=allow:q:Bun", "👎=deny:q"]);
    expect(reactionLegend(plan!)).toBe("Or react to this message:\n1️⃣ Pho\n2️⃣ Bun\n👎 Dismiss");
  });

  it("leaves a question with more than four options, or nothing answerable, text-only", () => {
    const five = ["a", "b", "c", "d", "e"].map((x) => ({ text: x, value: `allow:q:${x}` }));
    expect(planReactionCard(five)).toBeUndefined();
    expect(planReactionCard([{ text: "Dismiss", value: "deny:q", style: "danger" }])).toBeUndefined();
  });

  it("matches the emoji WhatsApp sends back, skin tone and variation selector included", () => {
    const card = { chatJid: "x", choices: planReactionCard(permission)! };
    expect(normalizeReactionEmoji("👍🏽")).toBe("👍");
    expect(matchReaction(card, "👍🏽")?.value).toBe("allow:c1");
    expect(matchReaction({ chatJid: "x", choices: [{ emoji: "1️⃣", label: "A", value: "v" }] }, "1⃣")?.value).toBe("v");
    expect(matchReaction(card, "❤️")).toBeUndefined();
    expect(matchReaction(card, "")).toBeUndefined();
  });
});
