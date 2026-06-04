import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentSessionState } from '../src/agents/session/session-state.ts'
import { SessionMapping } from '../src/agents/session/session-mapping.ts'
import { SessionStore } from '../src/agents/session/session-store.ts'
import { RunnerService } from '../src/agents/runtime/runner-service.ts'
import { resolveAgentTarget } from '../src/agents/routing/resolved-target.ts'
import { loadConfig, resolveSessionStorePath } from '../src/config/core/load-config.ts'
import { clisbotConfigSchema } from '../src/config/core/schema.ts'
import { renderDefaultConfigTemplate } from '../src/config/core/template.ts'
import { TmuxClient } from '../src/runners/tmux/client.ts'
import {
  DEFAULT_AGENT_TOOL_TEMPLATES,
  SUPPORTED_AGENT_CLI_TOOLS,
  buildRunnerFromToolTemplate,
  inferAgentCliToolId,
} from '../src/config/runtime/agent-tool-presets.ts'
import { isActiveTimerStatusLine } from '../src/runners/transcript/transcript-normalization.ts'

const tempDirs: string[] = [];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "clisbot-runner-service-"));
  tempDirs.push(dir);
  return dir;
}

function createConfig(dir: string) {
  const stateDir = join(dir, "state");
  const configPath = join(dir, "clisbot.json");
  const sessionStorePath = join(stateDir, "sessions.json");
  const socketPath = join(stateDir, "clisbot.sock");
  const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
  config.meta.schemaVersion = "0.1.53";
  mkdirSync(stateDir, { recursive: true });

  config.app.session.storePath = sessionStorePath;
  config.agents.defaults.workspace = join(dir, "workspaces", "{agentId}");
  config.agents.defaults.runner.defaults.tmux.socketPath = socketPath;
  config.agents.defaults.runner.defaults.trustWorkspace = false;
  config.agents.defaults.runner.defaults.startupDelayMs = 500;
  config.agents.defaults.runner.defaults.promptSubmitDelayMs = 1;
  config.agents.defaults.runner.defaults.stream.captureLines = 20;
  config.agents.defaults.runner.codex.command = "bash";
  config.agents.defaults.runner.codex.args = ["-lc", "printf 'ready\\n'; exec cat", "clisbot"];
  config.agents.defaults.runner.codex.startupReadyPattern = "ready";
  config.agents.defaults.runner.codex.sessionId = {
    create: {
      mode: "explicit",
      args: ["{sessionId}"],
    },
    capture: {
      mode: "off",
      statusCommand: "/status",
      pattern: "session id:",
      timeoutMs: 100,
      pollIntervalMs: 10,
    },
    resume: {
      mode: "off",
      args: [],
    },
  };
  config.bots.slack.defaults.enabled = false;
  config.bots.telegram.defaults.enabled = false;
  config.app.control.configReload.watch = false;

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return {
    configPath,
    sessionStorePath,
    socketPath,
  };
}

function readSessionEntry(storePath: string, sessionKey: string) {
  const store = JSON.parse(readFileSync(storePath, "utf8")) as Record<
    string,
    { sessionId?: string }
  >;
  return store[sessionKey] ?? null;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    const socketPath = join(dir, "state", "clisbot.sock");
    await Bun.spawn(["tmux", "-S", socketPath, "kill-server"], {
      stdout: "ignore",
      stderr: "ignore",
    }).exited;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('pi runner template', () => {
  test('SUPPORTED_AGENT_CLI_TOOLS includes "pi"', () => {
    expect(SUPPORTED_AGENT_CLI_TOOLS).toContain('pi')
  })

  test('DEFAULT_AGENT_TOOL_TEMPLATES["pi"] exists and has command: "pi"', () => {
    expect(DEFAULT_AGENT_TOOL_TEMPLATES['pi']).toBeDefined()
    expect(DEFAULT_AGENT_TOOL_TEMPLATES['pi'].command).toBe('pi')
  })

  test('sessionId.create.mode === "runner"', () => {
    expect(DEFAULT_AGENT_TOOL_TEMPLATES['pi'].sessionId.create.mode).toBe('runner')
  })

  test('sessionId.capture.mode === "status-command"', () => {
    expect(DEFAULT_AGENT_TOOL_TEMPLATES['pi'].sessionId.capture.mode).toBe('status-command')
  })

  test('sessionId.capture.statusCommand === "/session"', () => {
    expect(DEFAULT_AGENT_TOOL_TEMPLATES['pi'].sessionId.capture.statusCommand).toBe('/session')
  })

  test('sessionId.create.args deepEquals []', () => {
    expect(DEFAULT_AGENT_TOOL_TEMPLATES['pi'].sessionId.create.args).toEqual([])
  })

  test('sessionId.resume.mode === "command"', () => {
    expect(DEFAULT_AGENT_TOOL_TEMPLATES['pi'].sessionId.resume.mode).toBe('command')
  })

  test('newSessionCommand === "/new"', () => {
    expect(DEFAULT_AGENT_TOOL_TEMPLATES['pi'].newSessionCommand).toBe('/new')
  })

  test('startupReadyPattern matches "escape interrupt" text', () => {
    const pattern = DEFAULT_AGENT_TOOL_TEMPLATES['pi'].startupReadyPattern
    expect(pattern).toBeDefined()
    expect(new RegExp(pattern!, 'i').test('• escape interrupt (Ctrl+C to cancel)')).toBe(true)
    expect(new RegExp(pattern!, 'i').test('  escape interrupt help text here')).toBe(true)
    expect(new RegExp(pattern!, 'i').test('escape interrupt')).toBe(true)
  })

  test('inferAgentCliToolId("pi") returns "pi"', () => {
    expect(inferAgentCliToolId('pi')).toBe('pi')
  })

  test('inferAgentCliToolId("PI") returns "pi" (case-insensitive)', () => {
    expect(inferAgentCliToolId('PI')).toBe('pi')
  })

  test('buildRunnerFromToolTemplate("pi", template, undefined).args deepEquals []', () => {
    const template = DEFAULT_AGENT_TOOL_TEMPLATES['pi']
    const resolved = buildRunnerFromToolTemplate('pi', template, undefined)
    expect(resolved.args).toEqual([])
  })

  test('buildRunnerFromToolTemplate("pi", template, undefined).sessionId.resume.args deepEquals ["--session", "{sessionId}"]', () => {
    const template = DEFAULT_AGENT_TOOL_TEMPLATES['pi']
    const resolved = buildRunnerFromToolTemplate('pi', template, undefined)
    expect(resolved.sessionId.resume.args).toEqual(['--session', '{sessionId}'])
  })

  test('buildRunnerFromToolTemplate non-codex branch preserves template resume.args (not reconstructed)', () => {
    // Create a minimal template with custom resume args to verify template is preserved,
    // not reconstructed from scratch with hardcoded ["--resume", "{sessionId}", ...options]
    const customTemplate = {
      ...DEFAULT_AGENT_TOOL_TEMPLATES['pi'],
      sessionId: {
        ...DEFAULT_AGENT_TOOL_TEMPLATES['pi'].sessionId,
        resume: {
          ...DEFAULT_AGENT_TOOL_TEMPLATES['pi'].sessionId.resume,
          args: ['--attach', '{sessionId}', '--custom-flag'],
        },
      },
    }
    const resolved = buildRunnerFromToolTemplate('pi', customTemplate, undefined)
    expect(resolved.sessionId.resume.args).toEqual(['--attach', '{sessionId}', '--custom-flag'])
  })

  test('isActiveTimerStatusLine("Working...") returns true', () => {
    expect(isActiveTimerStatusLine('Working...')).toBe(true)
  })

  test('isActiveTimerStatusLine("• Working...") returns true', () => {
    expect(isActiveTimerStatusLine('• Working...')).toBe(true)
  })

  test('isActiveTimerStatusLine("Working... (some task)") returns false — trailing text not a pi status line', () => {
    expect(isActiveTimerStatusLine('Working... (some task)')).toBe(false)
  })

  test('startupBlockers is defined and has 2 entries', () => {
    expect(DEFAULT_AGENT_TOOL_TEMPLATES['pi'].startupBlockers).toBeDefined()
    expect(DEFAULT_AGENT_TOOL_TEMPLATES['pi'].startupBlockers?.length).toBe(2)
  })

  test('BLOCK-01: startupBlockers[0].pattern matches "Warning: No models available"', () => {
    const blockers = DEFAULT_AGENT_TOOL_TEMPLATES['pi'].startupBlockers!
    expect(new RegExp(blockers[0].pattern, 'i').test('Warning: No models available')).toBe(true)
    expect(new RegExp(blockers[0].pattern, 'i').test('tmux extended-keys is off')).toBe(false)
  })

  test('BLOCK-01: startupBlockers[0].message directs operator to configure a provider', () => {
    const message = DEFAULT_AGENT_TOOL_TEMPLATES['pi'].startupBlockers![0].message
    expect(message.toLowerCase()).toContain('configure')
    expect(message).toMatch(/login|DEEPSEEK_API_KEY|GITHUB_TOKEN|API.?KEY/i)
  })

  test('BLOCK-02: startupBlockers[1].pattern matches "tmux extended-keys is off"', () => {
    const blockers = DEFAULT_AGENT_TOOL_TEMPLATES['pi'].startupBlockers!
    expect(new RegExp(blockers[1].pattern, 'i').test('tmux extended-keys is off')).toBe(true)
    expect(new RegExp(blockers[1].pattern, 'i').test('Warning: No models available')).toBe(false)
  })

  test('BLOCK-02: startupBlockers[1].message includes set -g extended-keys on and .tmux.conf', () => {
    const message = DEFAULT_AGENT_TOOL_TEMPLATES['pi'].startupBlockers![1].message
    expect(message).toContain('extended-keys on')
    expect(message).toContain('.tmux.conf')
  })

  test('BLOCK-01 pattern compiles to valid regex (no throw)', () => {
    const blockers = DEFAULT_AGENT_TOOL_TEMPLATES['pi'].startupBlockers!
    expect(() => new RegExp(blockers[0].pattern, 'i')).not.toThrow()
  })

  test('BLOCK-02 pattern compiles to valid regex (no throw)', () => {
    const blockers = DEFAULT_AGENT_TOOL_TEMPLATES['pi'].startupBlockers!
    expect(() => new RegExp(blockers[1].pattern, 'i')).not.toThrow()
  })
})

describe('pi schema defaults', () => {
  // Parse with pi runner key absent — schema supplies full defaults
  function parsedWithoutPiOverrides() {
    const raw = JSON.parse(renderDefaultConfigTemplate())
    if (raw.agents?.defaults?.runner) {
      delete raw.agents.defaults.runner.pi
    }
    return clisbotConfigSchema.parse(raw).agents.defaults.runner.pi
  }
  const piDefaults = parsedWithoutPiOverrides()

  test('schema provides pi defaults when config has no runner overrides', () => {
    expect(piDefaults).toBeDefined()
    expect(piDefaults.command).toBe('pi')
  })

  test('parsed pi defaults have sessionId.create.mode === "runner"', () => {
    expect(piDefaults.sessionId!.create.mode).toBe('runner')
  })

  test('parsed pi defaults have sessionId.capture.mode === "status-command"', () => {
    expect(piDefaults.sessionId!.capture.mode).toBe('status-command')
  })

  test('parsed pi defaults have sessionId.capture.statusCommand === "/session"', () => {
    expect(piDefaults.sessionId!.capture.statusCommand).toBe('/session')
  })

  test('parsed pi defaults have sessionId.create.args deepEquals []', () => {
    expect(piDefaults.sessionId!.create.args).toEqual([])
  })

  test('parsed pi defaults have newSessionCommand === "/new"', () => {
    expect(piDefaults.newSessionCommand).toBe('/new')
  })

  test('parsed pi defaults have sessionId.resume.mode === "command"', () => {
    expect(piDefaults.sessionId!.resume.mode).toBe('command')
  })
})

describe('newSessionCommand defaults', () => {
  test('codex template declares /new as newSessionCommand', () => {
    expect(DEFAULT_AGENT_TOOL_TEMPLATES.codex.newSessionCommand).toBe('/new')
  })

  test('claude template declares /new as newSessionCommand', () => {
    expect(DEFAULT_AGENT_TOOL_TEMPLATES.claude.newSessionCommand).toBe('/new')
  })

  test('gemini template declares /clear as newSessionCommand', () => {
    expect(DEFAULT_AGENT_TOOL_TEMPLATES.gemini.newSessionCommand).toBe('/clear')
  })
})

describe('pi triggerNewSession routing (Fix 1)', () => {
  test('pi template does NOT satisfy skipLiveRotation guard — pi captures via /session', () => {
    // Pi uses capture.mode: "status-command" with /session, so it supports live rotation.
    // The skipLiveRotation guard (capture.mode=off + create.mode=explicit) is for runners
    // like claude that pre-specify session IDs and have no in-process capture command.
    const template = DEFAULT_AGENT_TOOL_TEMPLATES['pi']
    const skipLiveRotation =
      template.sessionId.capture.mode === 'off' &&
      template.sessionId.create.mode === 'explicit'
    expect(skipLiveRotation).toBe(false)
  })

  test('codex template does NOT satisfy skipLiveRotation guard (capture.mode is status-command)', () => {
    const template = DEFAULT_AGENT_TOOL_TEMPLATES['codex']
    const skipLiveRotation =
      template.sessionId.capture.mode === 'off' &&
      template.sessionId.create.mode === 'explicit'
    expect(skipLiveRotation).toBe(false)
  })

  test('claude template satisfies skipLiveRotation guard (capture.mode off + create.mode explicit)', () => {
    // claude pre-specifies session IDs via --session-id and has no in-process capture.
    // /new in claude creates a new session but clisbot cannot recapture its ID in-process.
    const template = DEFAULT_AGENT_TOOL_TEMPLATES['claude']
    expect(template.sessionId.capture.mode).toBe('off')
    expect(template.sessionId.create.mode).toBe('explicit')
  })

  test('gemini template does NOT satisfy skipLiveRotation guard (create.mode is runner)', () => {
    const template = DEFAULT_AGENT_TOOL_TEMPLATES['gemini']
    const skipLiveRotation =
      template.sessionId.capture.mode === 'off' &&
      template.sessionId.create.mode === 'explicit'
    expect(skipLiveRotation).toBe(false)
  })
})

describe('retryFreshStartAfterStoredResumeFailure gate (Fix 2)', () => {
  test('pi template satisfies gate continuation condition (create.mode runner + resume.mode command)', () => {
    const template = DEFAULT_AGENT_TOOL_TEMPLATES['pi']
    // Gate: resume.mode !== 'command' || (create.mode !== 'runner' && create.mode !== 'explicit')
    // Pi: resume.mode === 'command' (false), create.mode === 'runner' (false in inner AND)
    // Both false → gate condition is false → does NOT return null → pi session preserved
    const resumeMode = template.sessionId.resume.mode
    const createMode = template.sessionId.create.mode
    const gateRejectsSession =
      resumeMode !== 'command' ||
      (createMode !== 'runner' && createMode !== 'explicit')
    expect(gateRejectsSession).toBe(false)
  })

  test('unknown create.mode is rejected by gate (returns null)', () => {
    const resumeMode: string = 'command'
    const createMode: string = 'unknown-mode'
    const gateRejectsSession =
      resumeMode !== 'command' ||
      (createMode !== 'runner' && createMode !== 'explicit')
    expect(gateRejectsSession).toBe(true)
  })

  test('non-command resume.mode is still rejected by gate regardless of create.mode', () => {
    const resumeMode: string = 'off'
    const createMode: string = 'explicit'
    const gateRejectsSession =
      resumeMode !== 'command' ||
      (createMode !== 'runner' && createMode !== 'explicit')
    expect(gateRejectsSession).toBe(true)
  })
})

describe("RunnerService integration", () => {
  test("creates a fresh runner for a prefix-colliding session key when the stored sessionId is missing", async () => {
    const dir = createTempDir();
    const { configPath, sessionStorePath, socketPath } = createConfig(dir);
    const loaded = await loadConfig(configPath);
    const tmux = new TmuxClient(socketPath);
    const missingSessionTarget = {
      agentId: "default",
      sessionKey: "agent:default:telegram:group:-1003455688247:topic:1",
    };
    const foreignSessionTarget = {
      agentId: "default",
      sessionKey: "agent:default:telegram:group:-1003455688247:topic:1207",
    };
    const missingResolved = resolveAgentTarget(loaded, missingSessionTarget);
    const foreignResolved = resolveAgentTarget(loaded, foreignSessionTarget);

    writeFileSync(
      sessionStorePath,
      `${JSON.stringify(
        {
          [missingSessionTarget.sessionKey]: {
            agentId: "default",
            sessionKey: missingSessionTarget.sessionKey,
            workspacePath: missingResolved.workspacePath,
            runnerCommand: "bash",
            runtime: { state: "idle" },
            updatedAt: Date.now(),
          },
        },
        null,
        2,
      )}\n`,
    );

    await tmux.newSession({
      sessionName: foreignResolved.sessionName,
      cwd: foreignResolved.workspacePath,
      command: "bash -lc 'printf ready\\\\n; exec cat' clisbot foreign",
    });

    const runner = new RunnerService(
      loaded,
      tmux,
      (target) => resolveAgentTarget(loaded, target),
      new SessionMapping(new AgentSessionState(new SessionStore(resolveSessionStorePath(loaded)))),
    );

    const resolved = await runner.ensureSessionReady(missingSessionTarget);
    const storedEntry = readSessionEntry(sessionStorePath, missingSessionTarget.sessionKey);
    const liveSessions = await tmux.listSessions();

    expect(resolved.sessionName).toBe(missingResolved.sessionName);
    expect(liveSessions).toContain(missingResolved.sessionName);
    expect(liveSessions).toContain(foreignResolved.sessionName);
    expect(storedEntry?.sessionId).toMatch(UUID_PATTERN);
  }, 15000);

  test("creates distinct runners when two session keys normalize to the same tmux-safe base name", async () => {
    const dir = createTempDir();
    const { configPath, sessionStorePath, socketPath } = createConfig(dir);
    const loaded = await loadConfig(configPath);
    const tmux = new TmuxClient(socketPath);
    const firstTarget = {
      agentId: "default",
      sessionKey: "agent:default:telegram:group:qa/a",
    };
    const secondTarget = {
      agentId: "default",
      sessionKey: "agent:default:telegram:group:qa-a",
    };
    const firstResolved = resolveAgentTarget(loaded, firstTarget);
    const secondResolved = resolveAgentTarget(loaded, secondTarget);

    expect(firstResolved.sessionName).not.toBe(secondResolved.sessionName);

    await tmux.newSession({
      sessionName: secondResolved.sessionName,
      cwd: secondResolved.workspacePath,
      command: "bash -lc 'printf ready\\\\n; exec cat' clisbot foreign",
    });

    writeFileSync(
      sessionStorePath,
      `${JSON.stringify(
        {
          [firstTarget.sessionKey]: {
            agentId: "default",
            sessionKey: firstTarget.sessionKey,
            workspacePath: firstResolved.workspacePath,
            runnerCommand: "bash",
            runtime: { state: "idle" },
            updatedAt: Date.now(),
          },
        },
        null,
        2,
      )}\n`,
    );

    const runner = new RunnerService(
      loaded,
      tmux,
      (target) => resolveAgentTarget(loaded, target),
      new SessionMapping(new AgentSessionState(new SessionStore(resolveSessionStorePath(loaded)))),
    );

    const resolved = await runner.ensureSessionReady(firstTarget);
    const liveSessions = await tmux.listSessions();
    const storedEntry = readSessionEntry(sessionStorePath, firstTarget.sessionKey);

    expect(resolved.sessionName).toBe(firstResolved.sessionName);
    expect(liveSessions).toContain(firstResolved.sessionName);
    expect(liveSessions).toContain(secondResolved.sessionName);
    expect(storedEntry?.sessionId).toMatch(UUID_PATTERN);
  }, 15000);
});
