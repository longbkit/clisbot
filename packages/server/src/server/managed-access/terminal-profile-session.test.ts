import { describe, expect, it } from "vitest";
import { PROMPT_SENTINEL } from "@getpaseo/protocol/terminal-profiles";
import { resolveProfileLaunch } from "./terminal-profile-session.js";

const profiles = [
  { id: "claude", name: "Claude Code", command: "claude", args: [PROMPT_SENTINEL] },
  { id: "empty", name: "Empty", command: "  " },
  { id: "picker", name: "Picker", command: PROMPT_SENTINEL },
];

describe("resolveProfileLaunch", () => {
  it("runs the daemon's own profile with the prompt as one argument", () => {
    expect(resolveProfileLaunch(profiles, "claude", "fix it", true)).toEqual({
      name: "Claude Code",
      command: "claude",
      args: ["fix it"],
    });
  });

  it("refuses an unknown profile and one that resolves to no command, never a shell", () => {
    expect(resolveProfileLaunch(profiles, "missing", "", false)).toBeNull();
    expect(resolveProfileLaunch(profiles, "empty", "", false)).toBeNull();
  });

  it("refuses a restricted session a profile whose prompt would pick the program", () => {
    expect(resolveProfileLaunch(profiles, "picker", "bash", true)).toBeNull();
    expect(resolveProfileLaunch(profiles, "picker", "bash", false)?.command).toBe("bash");
  });

  it("keeps a restricted session's leading dash from reading as a CLI flag", () => {
    expect(
      resolveProfileLaunch(profiles, "claude", "--dangerously-skip-permissions", true)?.args,
    ).toEqual([" --dangerously-skip-permissions"]);
    expect(resolveProfileLaunch(profiles, "claude", "-v", false)?.args).toEqual(["-v"]);
  });
});
