import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { expandAutomationWorkflow, openAutomationWorkflow } from "./automation-workflow-model";
const source = `# keep this comment
name: test
on:
  slack.app_mention:
    connection: example
    filters: {from_users: ['*']}
run:
  target: {daemon: sandbox, cwd: /workspace}
  agent: {provider: pi, options: {custom: true}}
  prompt: Classify
  max_runtime: 2h
  idle_timeout: 10m
  output: {schema: {type: object, properties: {category: {type: string}}}}
`;
describe("workflow form model", () => {
  it("expands shorthand preserving Agent controls, comments and native reply authority", () => {
    const yaml = expandAutomationWorkflow(source);
    expect(yaml).toContain("# keep this comment");
    const value = parse(yaml);
    expect(value.run).toBeUndefined();
    expect(value.steps[0].agent.options).toEqual({ custom: true });
    expect(value.steps[0].allow_outputs).toEqual([{ type: "slack.reply" }]);
  });
  it("adds a separate Agent without copying output authority, and preserves advanced fields", () => {
    const model = openAutomationWorkflow(source);
    model.set(["values"], { category: "${{ steps.run.outputs.category }}" });
    model.addStep();
    model.set(["steps", 1, "prompt"], [{ text: "${{ values.category }}" }]);
    expect(model.getState().steps[1].allow_outputs).toBeUndefined();
    const reopened = openAutomationWorkflow(model.getState().yaml);
    expect(reopened.getState().value).toEqual(model.getState().value);
    expect(() => model.removeStep(0)).toThrow(/reference/);
  });
  it("keeps the draft when YAML is invalid", () => {
    const model = openAutomationWorkflow(source);
    const before = model.getState();
    expect(() => model.replaceYaml("steps: [")).toThrow();
    expect(model.getState()).toBe(before);
  });
  it("edits a single run without changing mixed-source native reply permissions", () => {
    const mixed = source.replace("on:\n", "on:\n  manual.run: {}\n");
    const model = openAutomationWorkflow(mixed);
    model.set(["steps", 0, "prompt"], [{ text: "Updated instruction" }]);
    const saved = parse(model.getState().yaml);
    expect(saved.steps).toBeUndefined();
    expect(saved.run.prompt).toBe("Updated instruction");
    expect(saved.run.outputs).toEqual({});
    expect(saved.on).toEqual(parse(mixed).on);
    const before = model.getState();
    expect(() => model.addStep()).toThrow(/reply permissions/);
    expect(model.getState()).toBe(before);
  });
  it("accepts single-run YAML again after editing a multistep draft", () => {
    const model = openAutomationWorkflow(source);
    model.addStep();
    expect(parse(model.getState().yaml).steps).toHaveLength(2);
    model.replaceYaml(source);
    expect(model.getState().steps).toHaveLength(1);
    model.set(["steps", 0, "agent", "model"], "local-model");
    expect(parse(model.getState().yaml).run.agent.model).toBe("local-model");
  });
});
