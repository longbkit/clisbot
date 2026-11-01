import { describe, expect, it } from "vitest";
import { formatCompactModelName, formatModelChipLabel } from "./model-name";

describe("formatCompactModelName", () => {
  it("drops the GPT prefix and hyphens", () => {
    expect(formatCompactModelName("GPT-6-Astra")).toBe("6 Astra");
    expect(formatCompactModelName("gpt-5.4-mini")).toBe("5.4 mini");
  });

  it("drops the Claude family name", () => {
    expect(formatCompactModelName("Claude Opus 5.5")).toBe("Opus 5.5");
    expect(formatCompactModelName("claude-sonnet-5")).toBe("sonnet 5");
  });

  it("drops the Gemini family name", () => {
    expect(formatCompactModelName("Gemini 3 Pro")).toBe("3 Pro");
  });

  it("keeps other names and only spaces their hyphens", () => {
    expect(formatCompactModelName("Kimi K2-Thinking")).toBe("Kimi K2 Thinking");
    expect(formatCompactModelName("Default")).toBe("Default");
  });

  it("keeps a name that is only the family", () => {
    expect(formatCompactModelName("GPT")).toBe("GPT");
    expect(formatCompactModelName("  Claude  ")).toBe("Claude");
  });
});

describe("formatModelChipLabel", () => {
  it("adds the effort after the short name", () => {
    expect(formatModelChipLabel("GPT-6-Astra", "Medium")).toBe("6 Astra Medium");
    expect(formatModelChipLabel("Claude Opus 5.5", "High")).toBe("Opus 5.5 High");
  });

  it("is just the name for a model without effort", () => {
    expect(formatModelChipLabel("Claude Haiku 5", null)).toBe("Haiku 5");
  });
});
