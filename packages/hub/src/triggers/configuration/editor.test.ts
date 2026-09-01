import { describe, expect, test } from "vitest";
import { parseDocument } from "yaml";
import { TriggerDocumentSchema } from "./schema.js";
import {
  createTriggerYaml,
  mergeTriggerForm,
  patchTriggerYaml,
  projectTriggerForm,
  splitAgentId,
} from "./editor.js";

const ADVANCED = `# keep this heading
name: answer
enabled: true
on:
  slack.mention:
    connection: company
    filters:
      from_users: ["*"]
      channels: [engineering]
inputs:
  urgency:
    type: string
    default: normal
max_runtime: 4h
run:
  target:
    daemon: office
    cwd: /workspace
    worktree:
      mode: branch-off
      newBranch: hub-work
  agent:
    provider: codex
    model: gpt-5.4
    mode: full-access
    thinkingOptionId: xhigh
    options:
      sandbox_mode: workspace-write
      approval_policy: never
  prompt: Handle it.
  max_runtime: 3h
  idle_timeout: 15m
  env:
    TEAM: core
  github:
    connection: company-github
    repositories: [paseo/hub]
  output:
    schema:
      type: object
  outputs:
    slack.reply:
      max: 3
  auto_archive: false
`;

describe("trigger form YAML bridge", () => {
  test("returns the original YAML byte-for-byte when the form did not change", () => {
    const projection = projectTriggerForm(ADVANCED);
    expect(projection.status).toBe("editable");
    if (projection.status === "editable") {
      expect(patchTriggerYaml(ADVANCED, projection.value)).toBe(ADVANCED);
    }
  });

  test("patches owned nodes while preserving comments and advanced configuration", () => {
    const projection = projectTriggerForm(ADVANCED);
    if (projection.status !== "editable") throw new Error(projection.reason);
    const yaml = patchTriggerYaml(ADVANCED, {
      ...projection.value,
      cwd: "/new-workspace",
      agent: "pi/gateway/vendor/model-v1",
      mode: "safe",
    });
    expect(yaml).toContain("# keep this heading");
    const value = TriggerDocumentSchema.parse(parseDocument(yaml).toJS());
    expect(value.run.target).toEqual({
      daemon: "office",
      cwd: "/new-workspace",
      worktree: { mode: "branch-off", newBranch: "hub-work" },
    });
    expect(value.run.agent).toEqual({
      provider: "pi",
      model: "gateway/vendor/model-v1",
      mode: "safe",
      thinkingOptionId: "xhigh",
      options: { sandbox_mode: "workspace-write", approval_policy: "never" },
    });
    expect(value.inputs).toBeDefined();
    expect(value.max_runtime).toBe("4h");
    expect(value.run.env).toEqual({ TEAM: "core" });
    expect(value.run.github).toEqual({
      connection: "company-github",
      repositories: ["paseo/hub"],
    });
    expect(value.run.output).toBeDefined();
    expect(value.run.outputs).toEqual({ "slack.reply": { max: 3 } });
    expect(value.run.auto_archive).toBe(false);
    expect(value.on["slack.mention"]?.filters?.channels).toEqual(["engineering"]);
  });

  test("edits provider options without touching thinking selection", () => {
    const projection = projectTriggerForm(ADVANCED);
    if (projection.status !== "editable") throw new Error(projection.reason);
    const yaml = patchTriggerYaml(ADVANCED, {
      ...projection.value,
      providerOptions: '{"sandbox_mode":"read-only"}',
    });
    const value = TriggerDocumentSchema.parse(parseDocument(yaml).toJS());
    if ("choices" in value.run.agent) throw new Error("expected an inline agent");
    expect(value.run.agent.options).toEqual({ sandbox_mode: "read-only" });
    expect(value.run.agent.thinkingOptionId).toBe("xhigh");
  });

  test("keeps advanced YAML added before a new trigger's first save", () => {
    const projection = projectTriggerForm(ADVANCED);
    if (projection.status !== "editable") throw new Error(projection.reason);
    const yaml = mergeTriggerForm(ADVANCED, { ...projection.value, prompt: "Changed." });
    expect(yaml).toContain("# keep this heading");
    const value = TriggerDocumentSchema.parse(parseDocument(yaml).toJS());
    expect(value.run.prompt).toBe("Changed.");
    expect(value.run.target.worktree).toBeDefined();
    expect(value.run.outputs).toBeDefined();
  });

  test("keeps unsupported shapes in YAML-only mode", () => {
    expect(projectTriggerForm(ADVANCED.replace("slack.mention:", "custom.event:"))).toEqual({
      status: "yaml_only",
      reason: "The form does not support the custom.event event.",
    });
    expect(
      projectTriggerForm(
        ADVANCED.replace(
          "provider: codex\n    model: gpt-5.4",
          "select: primary\n    choices:\n      primary:\n        provider: codex",
        ),
      ).status,
    ).toBe("yaml_only");
  });

  test("creates a deliberately minimal new trigger", () => {
    const yaml = createTriggerYaml({
      name: "answer",
      enabled: true,
      event: "manual.run",
      connection: "",
      allowedUsers: "*",
      daemon: "office",
      cwd: "/workspace",
      agent: "codex/gpt-5.4",
      mode: "full-access",
      thinkingOptionId: "",
      providerOptions: "",
      maxRuntime: "2h",
      idleTimeout: "10m",
      githubConnection: "",
      githubRepositories: "",
      githubPermissions: "",
      githubDuration: "1h",
      prompt: "Handle it.",
    });
    expect(parseDocument(yaml).toJS()).toEqual({
      name: "answer",
      enabled: true,
      on: { "manual.run": {} },
      run: {
        target: { daemon: "office", cwd: "/workspace" },
        agent: { provider: "codex", model: "gpt-5.4", mode: "full-access" },
        max_runtime: "2h",
        idle_timeout: "10m",
        prompt: "Handle it.",
      },
    });
  });

  test("submits an unchanged minimal manual trigger", () => {
    const initial = createTriggerYaml({
      name: "deploy",
      enabled: true,
      event: "manual.run",
      connection: "",
      allowedUsers: "*",
      daemon: "office",
      cwd: "/workspace",
      agent: "opencode",
      mode: "full-access",
      thinkingOptionId: "",
      providerOptions: "",
      maxRuntime: "2h",
      idleTimeout: "10m",
      githubConnection: "",
      githubRepositories: "",
      githubPermissions: "",
      githubDuration: "1h",
      prompt: "${{ paseo.prompt }}",
    });
    const projection = projectTriggerForm(initial);
    if (projection.status !== "editable") throw new Error(projection.reason);

    expect(mergeTriggerForm(initial, { ...projection.value, name: "release" })).toContain(
      "name: release",
    );
  });

  test("splits only the first slash in a full agent ID", () => {
    expect(splitAgentId("pi/gateway/vendor/model-v1")).toEqual({
      provider: "pi",
      model: "gateway/vendor/model-v1",
    });
  });
});
