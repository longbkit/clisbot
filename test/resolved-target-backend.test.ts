import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAgentTarget } from "../src/agents/routing/resolved-target.ts";
import { loadConfig } from "../src/config/core/load-config.ts";

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function loadConfigWith(agentEntry: Record<string, unknown>) {
  const tempDir = mkdtempSync(join(tmpdir(), "clisbot-resolved-target-"));
  tempDirs.push(tempDir);
  const configPath = join(tempDir, "clisbot.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      app: {},
      bots: {},
      agents: {
        list: [agentEntry],
      },
    }),
  );
  return loadConfig(configPath);
}

describe("resolved target backend selection", () => {
  test("default agent resolves to the tmux launch with the provider new-session command", async () => {
    const loaded = await loadConfigWith({ id: "default", default: true });

    const resolved = resolveAgentTarget(loaded, {
      agentId: "default",
      sessionKey: "main",
    });

    expect(resolved.runner.backend).toBe("tmux");
    expect(resolved.runner.command).toBe("codex");
    expect(resolved.runner.newSessionCommand).toBe("/new");
  });

  test("backend: acp alone launches the provider's catalog adapter preset", async () => {
    const loaded = await loadConfigWith({
      id: "default",
      default: true,
      runner: { backend: "acp" },
    });

    const resolved = resolveAgentTarget(loaded, {
      agentId: "default",
      sessionKey: "main",
    });

    expect(resolved.runner.backend).toBe("acp");
    expect(resolved.runner.command).toBe("bunx");
    expect(resolved.runner.args).toEqual(["@agentclientprotocol/codex-acp@1.1.14"]);
    expect(resolved.runner.acp.permissionPolicy).toBe("auto-allow");
    expect(resolved.runner.acp.authMethodId).toBeUndefined();
  });

  test("acp command override wins over the catalog preset and does not inherit tmux args", async () => {
    const loaded = await loadConfigWith({
      id: "default",
      default: true,
      runner: {
        backend: "acp",
        command: "codex-acp",
        env: { OPENAI_API_KEY: "test-key" },
        acp: { authMethodId: "chat-gpt" },
      },
    });

    const resolved = resolveAgentTarget(loaded, {
      agentId: "default",
      sessionKey: "main",
    });

    expect(resolved.runner.command).toBe("codex-acp");
    expect(resolved.runner.args).toEqual([]);
    expect(resolved.runner.env.OPENAI_API_KEY).toBe("test-key");
    expect(resolved.runner.acp.authMethodId).toBe("chat-gpt");
  });

  test("claude ACP resolves to the pinned catalog adapter", async () => {
    const loaded = await loadConfigWith({
      id: "default",
      default: true,
      cli: "claude",
      runner: { backend: "acp" },
    });

    const resolved = resolveAgentTarget(loaded, {
      agentId: "default",
      sessionKey: "main",
    });

    expect(resolved.runner.backend).toBe("acp");
    expect(resolved.runner.command).toBe("bunx");
    expect(resolved.runner.args).toEqual([
      "@agentclientprotocol/claude-agent-acp@0.66.0",
    ]);
  });

  test("gemini resolves /clear as the new-session command from the catalog", async () => {
    const loaded = await loadConfigWith({ id: "default", default: true, cli: "gemini" });

    const resolved = resolveAgentTarget(loaded, {
      agentId: "default",
      sessionKey: "main",
    });

    expect(resolved.runner.newSessionCommand).toBe("/clear");
    expect(resolved.runner.command).toBe("gemini");
  });
});
