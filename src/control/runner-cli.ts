import { loadConfigWithoutEnvResolution, resolveSessionStorePath } from "../config/load-config.ts";
import { parseCommandDurationMs } from "../agents/run-observation.ts";
import { SessionStore } from "../agents/session-store.ts";
import { TmuxClient } from "../runners/tmux/client.ts";
import { sleep } from "../shared/process.ts";
import { CliCommandError } from "./runtime-cli-shared.ts";
import { renderCliCommand } from "../shared/cli-name.ts";
import {
  buildRunnerSessionMetadata,
  listRunnerSessions,
  sortRunnerSessionMetadataNewestFirst,
  type RunnerSessionMetadata,
  type RunnerSessionSummary,
} from "./runner-debug-state.ts";

const SMOKE_BACKENDS = ["codex", "claude", "gemini", "all"] as const;
const SMOKE_SCENARIOS = [
  "startup_ready",
  "first_prompt_roundtrip",
  "session_id_roundtrip",
  "interrupt_during_run",
  "recover_after_runner_loss",
] as const;
const SMOKE_SUITES = ["launch-trio"] as const;

type SmokeBackend = (typeof SMOKE_BACKENDS)[number];
type SmokeScenario = (typeof SMOKE_SCENARIOS)[number];
type SmokeSuite = (typeof SMOKE_SUITES)[number];

type SmokeCommandOptions = {
  backend: SmokeBackend;
  scenario?: SmokeScenario;
  suite?: SmokeSuite;
  workspace?: string;
  agent?: string;
  artifactDir?: string;
  timeoutMs?: number;
  keepSession: boolean;
  json: boolean;
};

type RunnerInspectOptions = {
  sessionName?: string;
  latest: boolean;
  index?: number;
  lines: number;
};

type RunnerWatchOptions = {
  sessionName?: string;
  latest: boolean;
  next: boolean;
  index?: number;
  lines: number;
  intervalMs: number;
  timeoutMs?: number;
};

function parseRepeatedOption(args: string[], name: string) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) {
      continue;
    }

    const value = args[index + 1]?.trim();
    if (!value) {
      throw new CliCommandError(`Missing value for ${name}`, 2);
    }
    values.push(value);
  }

  return values;
}

function parseSingleOption(args: string[], name: string) {
  const values = parseRepeatedOption(args, name);
  if (values.length === 0) {
    return undefined;
  }
  return values[values.length - 1];
}

function hasFlag(args: string[], name: string) {
  return args.includes(name);
}

function parseDurationOption(
  args: string[],
  name: string,
  defaultMs?: number,
) {
  const raw = parseSingleOption(args, name);
  if (!raw) {
    return defaultMs;
  }

  const parsed = parseCommandDurationMs(raw);
  if (parsed == null) {
    throw new CliCommandError(`Invalid value for ${name}: ${raw}`, 2);
  }
  return parsed;
}

function parsePositiveIntOption(
  args: string[],
  names: string[],
  defaultValue: number,
) {
  for (const name of names) {
    const raw = parseSingleOption(args, name);
    if (!raw) {
      continue;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new CliCommandError(`Invalid value for ${name}: ${raw}`, 2);
    }
    return parsed;
  }
  return defaultValue;
}

function parseOptionalPositiveIntOption(args: string[], names: string[]) {
  for (const name of names) {
    const raw = parseSingleOption(args, name);
    if (!raw) {
      continue;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new CliCommandError(`Invalid value for ${name}: ${raw}`, 2);
    }
    return parsed;
  }
  return undefined;
}

function parsePositionalArgument(
  args: string[],
  optionNamesWithValues: string[] = [],
) {
  const valueOptions = new Set(optionNamesWithValues);
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current) {
      continue;
    }
    if (valueOptions.has(current)) {
      index += 1;
      continue;
    }
    if (!current.startsWith("-")) {
      return current;
    }
  }
  return undefined;
}

function isOneOf<T extends readonly string[]>(value: string, allowed: T): value is T[number] {
  return allowed.includes(value);
}

function parseTimeoutMs(raw: string | undefined) {
  if (!raw) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliCommandError("Invalid value for --timeout-ms", 2);
  }
  return parsed;
}

export function renderRunnerHelp() {
  return [
    renderCliCommand("runner"),
    "",
    "Usage:",
    `  ${renderCliCommand("runner")}`,
    `  ${renderCliCommand("runner --help")}`,
    `  ${renderCliCommand("runner list")}`,
    `  ${renderCliCommand("runner inspect <session-name>|--latest|--index <n> [--lines <n>]")}`,
    `  ${renderCliCommand("runner watch <session-name> [--lines <n>] [--interval <duration>]")}`,
    `  ${renderCliCommand("runner watch --index <n> [--lines <n>] [--interval <duration>] [--timeout <duration>]")}`,
    `  ${renderCliCommand("runner watch --latest [--lines <n>] [--interval <duration>] [--timeout <duration>]")}`,
    `  ${renderCliCommand("runner watch --next [--lines <n>] [--interval <duration>] [--timeout <duration>]")}`,
    `  ${renderCliCommand("runner smoke --backend <codex|claude|gemini> --scenario <name> [--workspace <path>] [--agent <id>] [--artifact-dir <path>] [--timeout-ms <n>] [--keep-session] [--json]")}`,
    `  ${renderCliCommand("runner smoke --backend all --suite launch-trio [--workspace <path>] [--agent <id>] [--artifact-dir <path>] [--timeout-ms <n>] [--keep-session] [--json]")}`,
    "",
    "Operator session debugging:",
    "  - `list` shows current tmux runner sessions, newest admitted turn first when known, plus stored sessionId/state when available",
    "  - `inspect` captures one snapshot; default tail is 100 lines",
    "  - `--index <n>` selects the 1-based order printed by `runner list`",
    "  - `watch --latest` follows the session that most recently admitted a new prompt",
    "  - `watch --next` waits for the next newly admitted prompt, then follows that session",
    "",
    "Smoke scenarios:",
    "  - startup_ready",
    "  - first_prompt_roundtrip",
    "  - session_id_roundtrip",
    "  - interrupt_during_run",
    "  - recover_after_runner_loss",
    "",
    "Smoke suites:",
    "  - launch-trio",
    "",
    "Current status:",
    "  - runner debug commands are available for operator tmux inspection",
    "  - `runner smoke` still validates the smoke command contract only",
  ].join("\n");
}

function parseInspectCommand(args: string[]): RunnerInspectOptions {
  const latest = hasFlag(args, "--latest");
  const index = parseOptionalPositiveIntOption(args, ["--index"]);
  const sessionName = parsePositionalArgument(args, ["--lines", "-n", "--index"]);
  const selectorCount = [Boolean(sessionName), latest, index != null].filter(Boolean).length;
  if (selectorCount !== 1) {
    throw new CliCommandError(
      `Usage: ${renderCliCommand("runner inspect <session-name>|--latest|--index <n> [--lines <n>]")}`,
      2,
    );
  }

  return {
    sessionName,
    latest,
    index,
    lines: parsePositiveIntOption(args, ["--lines", "-n"], 100),
  };
}

function parseWatchCommand(args: string[]): RunnerWatchOptions {
  const latest = hasFlag(args, "--latest");
  const next = hasFlag(args, "--next");
  const index = parseOptionalPositiveIntOption(args, ["--index"]);
  const sessionName = parsePositionalArgument(args, ["--lines", "-n", "--interval", "--timeout", "--index"]);
  const selectorCount = [Boolean(sessionName), latest, next, index != null].filter(Boolean).length;
  if (selectorCount > 1) {
    throw new CliCommandError("watch accepts only one of <session-name>, --latest, --next, or --index", 2);
  }

  if (selectorCount === 0) {
    throw new CliCommandError(
      [
        `Usage: ${renderCliCommand("runner watch <session-name> [--lines <n>] [--interval <duration>]")}`,
        `       ${renderCliCommand("runner watch --index <n> [--lines <n>] [--interval <duration>] [--timeout <duration>]")}`,
        `       ${renderCliCommand("runner watch --latest [--lines <n>] [--interval <duration>] [--timeout <duration>]")}`,
        `       ${renderCliCommand("runner watch --next [--lines <n>] [--interval <duration>] [--timeout <duration>]")}`,
      ].join("\n"),
      2,
    );
  }

  return {
    sessionName,
    latest,
    next,
    index,
    lines: parsePositiveIntOption(args, ["--lines", "-n"], 20),
    intervalMs: parseDurationOption(args, "--interval", 1000) ?? 1000,
    timeoutMs: parseDurationOption(args, "--timeout", next ? 120_000 : undefined),
  };
}

function parseSmokeCommand(args: string[]): SmokeCommandOptions {
  const backend = parseSingleOption(args, "--backend");
  if (!backend) {
    throw new CliCommandError(
      [
        `Usage: ${renderCliCommand("runner smoke --backend <codex|claude|gemini> --scenario <name> [--json]")}`,
        `       ${renderCliCommand("runner smoke --backend all --suite launch-trio [--json]")}`,
      ].join("\n"),
      2,
    );
  }
  if (!isOneOf(backend, SMOKE_BACKENDS)) {
    throw new CliCommandError(`Unsupported --backend value: ${backend}`, 2);
  }

  const rawScenario = parseSingleOption(args, "--scenario");
  const rawSuite = parseSingleOption(args, "--suite");
  if (rawScenario && rawSuite) {
    throw new CliCommandError("--scenario and --suite are mutually exclusive", 2);
  }

  if (rawScenario && !isOneOf(rawScenario, SMOKE_SCENARIOS)) {
    throw new CliCommandError(`Unsupported --scenario value: ${rawScenario}`, 2);
  }

  if (rawSuite && !isOneOf(rawSuite, SMOKE_SUITES)) {
    throw new CliCommandError(`Unsupported --suite value: ${rawSuite}`, 2);
  }

  const scenario = rawScenario as SmokeScenario | undefined;
  const suite = rawSuite as SmokeSuite | undefined;

  if (backend === "all") {
    if (scenario) {
      throw new CliCommandError("--backend all is only valid with --suite", 2);
    }
    if (!suite) {
      throw new CliCommandError("--backend all requires --suite launch-trio", 2);
    }
  } else {
    if (suite) {
      throw new CliCommandError(`--suite is only valid with --backend all`, 2);
    }
    if (!scenario) {
      throw new CliCommandError(`--backend ${backend} requires --scenario`, 2);
    }
  }

  return {
    backend,
    scenario,
    suite,
    workspace: parseSingleOption(args, "--workspace"),
    agent: parseSingleOption(args, "--agent"),
    artifactDir: parseSingleOption(args, "--artifact-dir"),
    timeoutMs: parseTimeoutMs(parseSingleOption(args, "--timeout-ms")),
    keepSession: hasFlag(args, "--keep-session"),
    json: hasFlag(args, "--json"),
  };
}

function renderSmokeNotImplementedResult(options: SmokeCommandOptions) {
  return {
    kind: "runner-smoke-framework-error",
    version: "v0",
    ok: false,
    backendId: options.backend,
    scenario: options.scenario ?? null,
    suite: options.suite ?? null,
    error: {
      code: "NOT_IMPLEMENTED",
      message: `${renderCliCommand("runner smoke")} is not implemented yet. The command surface and contract validation are ready; the real execution batch is next.`,
    },
    options: {
      workspace: options.workspace ?? null,
      agent: options.agent ?? null,
      artifactDir: options.artifactDir ?? null,
      timeoutMs: options.timeoutMs ?? null,
      keepSession: options.keepSession,
      json: options.json,
    },
  };
}

async function runSmokeCli(args: string[]) {
  if (args.length === 0 || hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log(renderRunnerHelp());
    return;
  }

  const options = parseSmokeCommand(args);
  const result = renderSmokeNotImplementedResult(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      [
        renderCliCommand("runner smoke"),
        "",
        `backend: ${options.backend}`,
        options.scenario ? `scenario: ${options.scenario}` : `suite: ${options.suite}`,
        "status: not implemented yet",
        "note: the smoke contract is validated, but real CLI execution is the next batch",
      ].join("\n"),
    );
  }
  process.exitCode = 3;
}

function formatTimestamp(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "unknown";
  }
  return new Date(value).toISOString();
}

function isTmuxSessionMissingError(error: unknown) {
  return error instanceof Error &&
    /can't find session:|no server running|failed with code \d+: .*can't find session:/i.test(error.message);
}

function renderWatchFrame(params: {
  sessionName: string;
  lines: number;
  sessionId?: string;
  agentId?: string;
  state: string;
  snapshot: string;
}) {
  return [
    renderCliCommand("runner watch"),
    "",
    `session: ${params.sessionName}`,
    params.agentId ? `agent: ${params.agentId}` : null,
    `sessionId: ${params.sessionId?.trim() || "none"}`,
    `lines: ${params.lines}`,
    `state: ${params.state}`,
    "",
    params.snapshot.trimEnd() || "(empty pane)",
  ].filter((line): line is string => Boolean(line)).join("\n");
}

async function loadRunnerContext() {
  const loadedConfig = await loadConfigWithoutEnvResolution(process.env.CLISBOT_CONFIG_PATH);
  const sessionStore = new SessionStore(resolveSessionStorePath(loadedConfig));
  const entries = await sessionStore.list();
  const tmux = new TmuxClient(loadedConfig.raw.tmux.socketPath);
  return {
    loadedConfig,
    sessionStore,
    entries,
    tmux,
  };
}

async function runListCli() {
  const loadedConfig = await loadConfigWithoutEnvResolution(process.env.CLISBOT_CONFIG_PATH);
  const sessions = await listRunnerSessions(loadedConfig);
  if (sessions.length === 0) {
    console.log(`No tmux runner sessions on ${loadedConfig.raw.tmux.socketPath}`);
    return;
  }

  console.log([
    renderCliCommand("runner list"),
    "",
    ...sessions.map(renderRunnerListSession),
  ].join("\n"));
}

function renderRunnerListSession(session: RunnerSessionSummary) {
  const prefix = `- [${session.index ?? "?"}] sessionName: ${session.sessionName}`;
  if (!session.entry) {
    return [
      prefix,
      "  sessionId: none",
      "  state: unmanaged",
    ].join("\n");
  }

  return [
    prefix,
    `  agent: ${session.entry.agentId}`,
    `  sessionId: ${session.entry.sessionId?.trim() || "none"}`,
    `  state: ${session.entry.runtime?.state ?? "no-runtime"}`,
    `  lastAdmittedPromptAt: ${formatTimestamp(session.entry.lastAdmittedPromptAt)}`,
  ].join("\n");
}

function resolveIndexedSession(sessions: RunnerSessionSummary[], index: number) {
  const selected = sessions[index - 1];
  if (!selected) {
    throw new CliCommandError(
      `No runner session at index ${index}. Run ${renderCliCommand("runner list", { inline: true })} to see valid indexes.`,
      1,
    );
  }
  return selected;
}

async function runInspectCli(args: string[]) {
  const options = parseInspectCommand(args);
  const context = await loadRunnerContext();
  const sessionMetadata = buildRunnerSessionMetadata(context.loadedConfig, context.entries);
  let sessionName = options.sessionName;

  if (options.latest) {
    const latest = resolveLatestSessionMetadata(sessionMetadata);
    if (!latest) {
      throw new CliCommandError(
        `No admitted prompt is recorded yet. Use ${renderCliCommand("runner list", { inline: true })} or inspect a named session.`,
        1,
      );
    }
    sessionName = latest.sessionName;
  }

  if (options.index != null) {
    sessionName = resolveIndexedSession(await listRunnerSessions(context.loadedConfig), options.index).sessionName;
  }

  if (!sessionName || !(await context.tmux.hasSession(sessionName))) {
    throw new CliCommandError(`tmux session "${sessionName ?? "unknown"}" does not exist`, 1);
  }
  const snapshot = await context.tmux.capturePane(sessionName, options.lines);
  console.log(snapshot.trimEnd());
}

function resolveLatestSessionMetadata(entries: RunnerSessionMetadata[]) {
  return sortRunnerSessionMetadataNewestFirst(entries).find((item) =>
    typeof item.entry.lastAdmittedPromptAt === "number" && item.entry.lastAdmittedPromptAt > 0
  ) ?? null;
}

async function resolveWatchSelection(options: RunnerWatchOptions) {
  const context = await loadRunnerContext();
  const sessionMetadata = buildRunnerSessionMetadata(context.loadedConfig, context.entries);

  if (options.sessionName) {
    return {
      sessionName: options.sessionName,
      metadata: sessionMetadata.find((item) => item.sessionName === options.sessionName) ?? null,
      tmux: context.tmux,
    };
  }

  if (options.index != null) {
    const selected = resolveIndexedSession(await listRunnerSessions(context.loadedConfig), options.index);
    return {
      sessionName: selected.sessionName,
      metadata: sessionMetadata.find((item) => item.sessionName === selected.sessionName) ?? null,
      tmux: context.tmux,
    };
  }

  if (options.latest) {
    const latest = resolveLatestSessionMetadata(sessionMetadata);
    if (!latest) {
      throw new CliCommandError(
        `No admitted prompt is recorded yet. Use ${renderCliCommand("runner watch --next", { inline: true })} or watch a named session.`,
        1,
      );
    }
    return {
      sessionName: latest.sessionName,
      metadata: latest,
      tmux: context.tmux,
    };
  }

  const deadline = typeof options.timeoutMs === "number" ? Date.now() + options.timeoutMs : Number.POSITIVE_INFINITY;
  let baseline = Math.max(
    0,
    ...sessionMetadata.map((item) => item.entry.lastAdmittedPromptAt ?? 0),
  );

  while (Date.now() <= deadline) {
    const nextEntries = buildRunnerSessionMetadata(
      context.loadedConfig,
      await context.sessionStore.list(),
    );
    const admittedAfterBaseline = nextEntries
      .filter((item) => (item.entry.lastAdmittedPromptAt ?? 0) > baseline)
      .sort((left, right) => {
        const leftPromptAt = left.entry.lastAdmittedPromptAt ?? 0;
        const rightPromptAt = right.entry.lastAdmittedPromptAt ?? 0;
        if (leftPromptAt !== rightPromptAt) {
          return leftPromptAt - rightPromptAt;
        }
        return left.sessionName.localeCompare(right.sessionName);
      });
    if (admittedAfterBaseline[0]) {
      return {
        sessionName: admittedAfterBaseline[0].sessionName,
        metadata: admittedAfterBaseline[0],
        tmux: context.tmux,
      };
    }

    baseline = Math.max(
      baseline,
      ...nextEntries.map((item) => item.entry.lastAdmittedPromptAt ?? 0),
    );
    await sleep(Math.min(options.intervalMs, 250));
  }

  throw new CliCommandError(
    `No session admitted a new prompt within ${options.timeoutMs ?? 120_000}ms.`,
    1,
  );
}

async function runWatchCli(args: string[]) {
  const options = parseWatchCommand(args);
  const selection = await resolveWatchSelection(options);
  const startedAt = Date.now();
  let lastRendered = "";

  while (true) {
    const timedOut = typeof options.timeoutMs === "number" && Date.now() - startedAt >= options.timeoutMs;
    if (timedOut) {
      return;
    }

    let status = "waiting for tmux session";
    let snapshot = "";
    try {
      snapshot = (await selection.tmux.capturePane(selection.sessionName, options.lines)).trimEnd();
      status = "watching";
    } catch (error) {
      if (!isTmuxSessionMissingError(error)) {
        throw error;
      }
    }

    const frame = renderWatchFrame({
      sessionName: selection.sessionName,
      sessionId: selection.metadata?.entry.sessionId,
      agentId: selection.metadata?.entry.agentId,
      lines: options.lines,
      state: status,
      snapshot,
    });

    if (process.stdout.isTTY) {
      process.stdout.write("\x1Bc");
      process.stdout.write(`${frame}\n`);
    } else if (frame !== lastRendered) {
      console.log(frame);
    }
    lastRendered = frame;

    await sleep(options.intervalMs);
  }
}

export async function runRunnerCli(args: string[]) {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    console.log(renderRunnerHelp());
    return;
  }

  if (subcommand === "list") {
    await runListCli();
    return;
  }

  if (subcommand === "inspect") {
    await runInspectCli(args.slice(1));
    return;
  }

  if (subcommand === "watch") {
    await runWatchCli(args.slice(1));
    return;
  }

  if (subcommand === "smoke") {
    await runSmokeCli(args.slice(1));
    return;
  }

  throw new CliCommandError(renderRunnerHelp(), 2);
}
