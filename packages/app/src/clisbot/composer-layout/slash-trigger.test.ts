import { describe, expect, it } from "vitest";
import { resolveSlashTriggerEdit } from "./slash-trigger";

describe("resolveSlashTriggerEdit", () => {
  it("opens the command list on an empty draft", () => {
    expect(resolveSlashTriggerEdit("", { start: 0, end: 0 })).toEqual({
      text: "/",
      selection: { start: 1, end: 1 },
    });
    expect(resolveSlashTriggerEdit("  \n", { start: 3, end: 3 }).text).toBe("/");
  });

  it("closes it again when the draft is only the slash", () => {
    expect(resolveSlashTriggerEdit("/", { start: 1, end: 1 })).toEqual({
      text: "",
      selection: { start: 0, end: 0 },
    });
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
