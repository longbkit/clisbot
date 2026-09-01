import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "vitest";
import { compileHubBundle, type HubBundleFile } from "../../config/bundle.js";
import type { CompiledHubConfig, CompiledTrigger } from "../../config/compiler.js";
import { migrateLegacyBundle } from "./index.js";

const exhaustiveHub = `
environments:
  runner:
    kind: daemon
    daemon: devbox
    cwd: /workspace/company
    worktree:
      mode: branch-off
      newBranch: trigger-\${{ paseo.execution.id }}
      base: main
agents:
  codex:
    provider: codex
    model: gpt-5.6-sol
    thinkingOptionId: xhigh
    options:
      sandbox_workspace_write:
        network_access: false
  claude:
    provider: claude
    mode: bypassPermissions
`;

const exhaustiveWorkflow = `
name: exhaustive
on: slack.mention
max_runtime: 2h
inputs:
  agent:
    type: string
    default: codex
    choices: [codex, claude]
  retries:
    type: number
    default: 2
  source:
    type: string
    default: slack
  trusted:
    type: boolean
    default: true
  priority:
    type: number
    default: 2
filters:
  connection: acme-slack
  pattern: '^help'
  contains: urgent
  label: support
  labels: [bug, urgent]
  repo: getpaseo/hub
  guild: paseo
  workspace: acme
  project: linear-project
  states: [started]
  exclude_labels: [wontfix]
  assignees: [maintainer]
  channels: [support]
  from_users: [U123]
  inputs: { source: slack, trusted: true, priority: 2 }
steps:
  - id: work
    environment: runner
    max_runtime: 90m
    idle_timeout: 7m
    agent: "\${{ paseo.inputs.agent }}"
    env: { NODE_ENV: production }
    github:
      connection: getpaseo
      repositories: [getpaseo/hub]
      permissions: { contents: read, issues: write }
      duration: 30m
    prompt:
      - include: partials/safety.md
      - text: "Request: \${{ paseo.prompt }}"
    output:
      schema:
        type: object
        properties: { answer: { type: string } }
        required: [answer]
    allow_outputs:
      - { type: slack.reply, max: 5, required: true }
      - { type: github.comment, max: 1 }
    auto_archive: false
`;

function exhaustiveFiles(): HubBundleFile[] {
  return [
    { path: ".paseo/hub.yml", content: exhaustiveHub },
    { path: ".paseo/workflows/exhaustive.yml", content: exhaustiveWorkflow },
    {
      path: ".paseo/workflows/partials/safety.md",
      content: "Never disclose secrets.",
    },
  ];
}

describe("legacy migration compatibility matrix", () => {
  it("preserves every one-run field while removing shared resources and partials", () => {
    const before = compileHubBundle(exhaustiveFiles()).configuration;
    const migrated = migrateLegacyBundle({ files: exhaustiveFiles() });
    assert.equal(migrated.length, 1);
    const trigger = migrated[0];
    assert.equal(trigger?.format, "single_run");
    if (trigger?.format !== "single_run") return;

    assert.deepEqual(
      executionSemantics(trigger.compiled.events[0]!, trigger.compiled.environment),
      executionSemantics(before.triggers[0]!, before.environments[0]!),
    );
    assert.match(trigger.yaml, /max_runtime: 2h/u);
    assert.match(trigger.yaml, /select: \$\{\{ paseo\.inputs\.agent \}\}/u);
    assert.match(trigger.yaml, /network_access: false/u);
    assert.doesNotMatch(trigger.yaml, /include:|partials:|steps:|environments:/u);
  });

  it("explodes the checked-in real project fixture without dropping a workflow", () => {
    const files = fixtureBundle("src/config/fixtures/current-project");
    const migrated = migrateLegacyBundle({ files });
    assert.deepEqual(
      migrated.map(({ name, format }) => ({ name, format })),
      [
        { name: "discord-request", format: "legacy_multistep" },
        { name: "github-hub", format: "single_run" },
        { name: "github-paseo", format: "single_run" },
        { name: "slack-request", format: "legacy_multistep" },
      ],
    );
    for (const trigger of migrated) {
      if (trigger.format !== "legacy_multistep") continue;
      assert.match(trigger.yaml, /legacy_multistep:/u);
      assert.match(trigger.yaml, /Choose one configured repository/u);
      assert.doesNotMatch(trigger.yaml, /include:/u);
      assert.match(trigger.authoredYaml, /include: partials\/classify\.md/u);
    }
  });

  it.each([
    ["multiple steps", "trigger has multiple steps"],
    ["workflow values", "trigger defines workflow values"],
    ["conditional run", "run is conditional"],
    ["dynamic target", "target environment is selected dynamically"],
    ["duplicate outputs", "run contains duplicate output grants"],
  ])("keeps %s in the legacy execution lane", (variant, blocker) => {
    const files = blockerFixture(variant);
    const migrated = migrateLegacyBundle({ files });
    assert.equal(migrated[0]?.format, "legacy_multistep");
    if (migrated[0]?.format !== "legacy_multistep") return;
    assert.ok(migrated[0].conversionBlockers.includes(blocker));
    assert.doesNotMatch(migrated[0].yaml, /include:/u);
  });

  it("rejects an invalid active normalized revision instead of marking it migrated", () => {
    const files = exhaustiveFiles();
    const normalized = structuredClone(compileHubBundle(files).configuration);
    normalized.triggers[0]!.inputs["agent"]!.choices = ["codex", "claude", null];
    assert.throws(
      () => migrateLegacyBundle({ files, normalizedConfiguration: normalized }),
      /invalid compiled workflow contract/u,
    );
  });
});

function executionSemantics(
  trigger: CompiledTrigger,
  environment: CompiledHubConfig["environments"][number],
) {
  const step = trigger.steps[0]!;
  return {
    trigger: {
      on: trigger.on,
      maxRuntimeMs: trigger.maxRuntimeMs,
      inputs: trigger.inputs,
      values: trigger.values,
      filters: trigger.filters,
    },
    environment: { ...environment, name: undefined },
    step: {
      ...step,
      id: undefined,
      environment: undefined,
      prompt: step.prompt
        .map((block) => (block.kind === "text" ? block.value : block.content))
        .join("\n"),
    },
  };
}

function fixtureBundle(root: string): HubBundleFile[] {
  return walk(root).map((path) => ({
    path: relative(root, path),
    content: readFileSync(path, "utf8"),
  }));
}

function walk(root: string): string[] {
  return readdirSync(root)
    .flatMap((entry) => {
      const path = join(root, entry);
      return statSync(path).isDirectory() ? walk(path) : [path];
    })
    .sort();
}

function blockerFixture(variant: string): HubBundleFile[] {
  const environment = exhaustiveHub;
  const extraStep =
    variant === "multiple steps"
      ? "\n  - id: later\n    environment: runner\n    max_runtime: 5m\n    idle_timeout: 1m\n    agent: { provider: codex }\n    prompt: [{ text: later }]\n"
      : "";
  const values = variant === "workflow values" ? 'values: { answer: "${{ paseo.prompt }}" }\n' : "";
  const dynamicInput =
    variant === "dynamic target"
      ? "inputs:\n  target: { type: string, required: true, choices: [runner] }\n"
      : "";
  const target = variant === "dynamic target" ? "${{ paseo.inputs.target }}" : "runner";
  const condition = variant === "conditional run" ? "    if: \"${{ paseo.prompt != '' }}\"\n" : "";
  const outputs =
    variant === "duplicate outputs"
      ? "    allow_outputs:\n      - { type: slack.reply, max: 1 }\n      - { type: slack.reply, max: 2 }\n"
      : "";
  return [
    { path: ".paseo/hub.yml", content: environment },
    {
      path: ".paseo/workflows/test.yml",
      content: `name: test\non: slack.mention\nmax_runtime: 1h\nfilters: { from_users: [U123] }\n${dynamicInput}${values}steps:\n  - id: work\n    environment: "${target}"\n    max_runtime: 1h\n    idle_timeout: 5m\n    agent: { provider: codex }\n${condition}    prompt: [{ text: work }]\n${outputs}${extraStep}`,
    },
  ];
}
