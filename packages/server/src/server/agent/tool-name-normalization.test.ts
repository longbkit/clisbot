import { describe, expect, it } from "vitest";

import {
  getClisbotToolLeafName,
  isClisbotToolName,
} from "@clisbot/protocol/tool-name-normalization";

describe("isClisbotToolName", () => {
  it("detects Claude Code format", () => {
    expect(isClisbotToolName("mcp__clisbot__create_agent")).toBe(true);
    expect(isClisbotToolName("mcp__clisbot__list_agents")).toBe(true);
  });

  it("detects clisbot_voice variant", () => {
    expect(isClisbotToolName("mcp__clisbot_voice__create_agent")).toBe(true);
    expect(isClisbotToolName("clisbot_voice.create_agent")).toBe(true);
  });

  it("excludes speak tools", () => {
    expect(isClisbotToolName("mcp__clisbot_voice__speak")).toBe(false);
    expect(isClisbotToolName("mcp__clisbot__speak")).toBe(false);
    expect(isClisbotToolName("clisbot.speak")).toBe(false);
  });

  it("detects Codex dot format", () => {
    expect(isClisbotToolName("clisbot.create_agent")).toBe(true);
  });

  it("rejects non-clisbot tools", () => {
    expect(isClisbotToolName("Bash")).toBe(false);
    expect(isClisbotToolName("Read")).toBe(false);
    expect(isClisbotToolName("mcp__other_server__some_tool")).toBe(false);
  });
});

describe("getClisbotToolLeafName", () => {
  it("extracts leaf from Claude Code format", () => {
    expect(getClisbotToolLeafName("mcp__clisbot__create_agent")).toBe("create_agent");
  });

  it("extracts leaf from Codex format", () => {
    expect(getClisbotToolLeafName("clisbot.create_agent")).toBe("create_agent");
    expect(getClisbotToolLeafName("clisbot.list_agents")).toBe("list_agents");
  });

  it("returns null for non-clisbot tools", () => {
    expect(getClisbotToolLeafName("Bash")).toBeNull();
  });
});
