import { describe, it, expect } from "vitest";
import { dump } from "js-yaml";
import {
  compileAutomationDocument,
  editableAutomationYaml,
  automationAgents,
} from "./workflow-document.js";
import { evaluateExpression, parseExpression } from "../../workflows/expression.js";

const workflow = {
  name: "classify-work",
  on: { "manual.run": {} },
  max_runtime: "2h",
  environments: [{ name: "target", kind: "daemon", daemon: "sandbox", cwd: "/workspace" }],
  agents: { safe: { provider: "codex", mode: "read-only" }, worker: { provider: "pi" } },
  values: { selected: "${{ steps.classify.outputs.agent }}" },
  steps: [
    {
      id: "classify",
      environment: "target",
      agent: "safe",
      prompt: [{ text: "Classify ${{ paseo.prompt }}" }],
      max_runtime: "10m",
      idle_timeout: "5m",
      output: {
        schema: {
          type: "object",
          required: ["agent"],
          properties: { agent: { enum: ["safe", "worker"] } },
          additionalProperties: false,
        },
      },
    },
    {
      id: "work",
      environment: "target",
      agent: "${{ values.selected }}",
      if: "${{ steps.classify.outputs.agent == 'worker' }}",
      prompt: [{ text: "Result: ${{ steps.classify.outputs.agent }}" }],
      max_runtime: "1h",
      idle_timeout: "5m",
      allow_outputs: [{ type: "slack.reply", max: 1 }],
    },
  ],
};
describe("workflow authoring", () => {
  it("compiles ordered Agents, finite selection, conditions and explicit per-step outputs", () => {
    const compiled = compileAutomationDocument(dump(workflow));
    expect(compiled.format).toBe("workflow");
    const steps = compiled.events[0]!.steps;
    expect(steps.map((step) => step.id)).toEqual(["classify", "work"]);
    expect(steps[0]!.allowOutputs).toEqual([]);
    expect(steps[1]!.allowOutputs).toEqual([{ type: "slack.reply", max: 1, required: false }]);
    expect(automationAgents(compiled).map((agent) => agent.provider)).toContain("pi");
    expect(
      evaluateExpression(parseExpression("${{ steps.classify.outputs.agent }}"), {
        prompt: "",
        context: {},
        inputs: {},
        values: {},
        steps: { classify: { status: "succeeded", output: { agent: "worker" } } },
      }),
    ).toBe("worker");
  });
  it("projects saved snapshots back into editable workflows without changing executable meaning", () => {
    const compiled = compileAutomationDocument(dump(workflow));
    const yaml = editableAutomationYaml(
      dump({
        legacy_multistep: { trigger: compiled.events[0], environments: compiled.environments },
      }),
      true,
    );
    expect(yaml).not.toContain("legacy_multistep");
    const roundtrip = compileAutomationDocument(yaml);
    expect(roundtrip.events).toEqual(compiled.events);
    expect(roundtrip.environments).toEqual(compiled.environments);
  });
  it("rejects forward references and non-finite authority through the existing compiler", () => {
    expect(() =>
      compileAutomationDocument(dump({ ...workflow, steps: workflow.steps.toReversed() })),
    ).toThrow();
    expect(() =>
      compileAutomationDocument(
        dump({
          ...workflow,
          steps: [workflow.steps[0], { ...workflow.steps[1], agent: "${{ paseo.prompt }}" }],
        }),
      ),
    ).toThrow();
  });
});
