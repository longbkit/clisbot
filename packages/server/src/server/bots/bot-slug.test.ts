import { describe, expect, it } from "vitest";
import { botSlug, uniqueBotSlug } from "./bot-slug.js";

describe("botSlug", () => {
  it("lowercases, replaces symbols and trims hyphens", () => {
    expect(botSlug("Ops Bot!")).toBe("ops-bot");
    expect(botSlug("  Ops   Bot  ")).toBe("ops-bot");
  });

  it("falls back to bot for a symbol-only name", () => {
    expect(botSlug("!!!")).toBe("bot");
  });
});

describe("uniqueBotSlug", () => {
  it("returns the base slug when free", async () => {
    expect(await uniqueBotSlug("Ops Bot", new Set(), async () => false)).toBe("ops-bot");
  });

  it("suffixes on a recorded slug, an existing directory, and keeps counting", async () => {
    const taken = new Set(["ops-bot", "ops-bot-3"]);
    const directories = new Set(["ops-bot-2"]);
    expect(await uniqueBotSlug("Ops Bot", taken, async (slug) => directories.has(slug))).toBe(
      "ops-bot-4",
    );
  });
});
