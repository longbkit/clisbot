import { describe, expect, it } from "vitest";
import { isSlashCommandDraft, resolveSlashTriggerEdit } from "./slash-trigger";

describe("resolveSlashTriggerEdit", () => {
  it("opens the command list on an empty draft", () => {
    expect(resolveSlashTriggerEdit("", { start: 0, end: 0 })).toEqual({
      text: "/",
      selection: { start: 1, end: 1 },
    });
    expect(resolveSlashTriggerEdit("  \n", { start: 3, end: 3 }).text).toBe("/");
  });

  it("closes it again while the draft is only a command being typed", () => {
    expect(resolveSlashTriggerEdit("/", { start: 1, end: 1 })).toEqual({
      text: "",
      selection: { start: 0, end: 0 },
    });
    expect(resolveSlashTriggerEdit("/rev", { start: 4, end: 4 }).text).toBe("");
  });

  it("knows when the command list is open", () => {
    expect(isSlashCommandDraft("/")).toBe(true);
    expect(isSlashCommandDraft("/review")).toBe(true);
    expect(isSlashCommandDraft("/review now")).toBe(false);
    expect(isSlashCommandDraft("fix /")).toBe(false);
    expect(isSlashCommandDraft("")).toBe(false);
  });

  it("types a slash at the caret, after a space when it would touch a word", () => {
    expect(resolveSlashTriggerEdit("fix this", { start: 8, end: 8 })).toEqual({
      text: "fix this /",
      selection: { start: 10, end: 10 },
    });
    expect(resolveSlashTriggerEdit("fix this", { start: 4, end: 4 })).toEqual({
      text: "fix /this",
      selection: { start: 5, end: 5 },
    });
    expect(resolveSlashTriggerEdit("fix this", { start: 0, end: 0 }).text).toBe("/fix this");
  });

  it("replaces a selection and clamps a caret past the end", () => {
    expect(resolveSlashTriggerEdit("fix this", { start: 4, end: 8 }).text).toBe("fix /");
    expect(resolveSlashTriggerEdit("fix", { start: 99, end: 99 }).text).toBe("fix /");
  });
});
