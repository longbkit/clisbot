import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { compileHubConfig } from "../config/compiler.js";
import { evaluateExpression, ExpressionEvaluationError, parseExpression } from "./expression.js";

describe("Phase 3 structured routing contract", () => {
  it("evaluates the dedicated grammar with short-circuit semantics", () => {
    const context = {
      prompt: "request",
      context: null,
      inputs: {},
      steps: { classify: { status: "skipped", output: null } },
      values: {},
    };
    assert.equal(
      evaluateExpression(
        parseExpression("paseo.inputs.repo != null && steps.classify.outputs.repo == 'hub'"),
        context,
      ),
      false,
    );
    assert.equal(evaluateExpression(parseExpression("paseo.inputs.repo ?? 'hub'"), context), "hub");
    assert.deepEqual(evaluateExpression(parseExpression('{"repo":["hub", null]}'), context), {
      repo: ["hub", null],
    });
    assert.throws(
      () => evaluateExpression(parseExpression("steps.classify.outputs.repo == 'hub'"), context),
      ExpressionEvaluationError,
    );
  });

  it("compiles ordered conditional steps, values, and a structured output", () => {
    const configuration = compileHubConfig({
      environments: [{ name: "runner", kind: "daemon", daemon: "runner", cwd: "/repo" }],
      triggers: [
        {
          name: "route-request",
          on: "manual.run",
          max_runtime: "1h",
          inputs: {
            repo: { type: "string", choices: ["paseo", "hub"] },
          },
          values: {
            selected_repo: "${{ paseo.inputs.repo ?? steps.classify.outputs.repo }}",
          },
          steps: [
            {
              id: "classify",
              if: "${{ paseo.inputs.repo == null }}",
              environment: "runner",
              max_runtime: "2m",
              idle_timeout: "30s",
              agent: { provider: "codex" },
              prompt: [{ text: "Classify" }],
              output: {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["repo"],
                  properties: { repo: { enum: ["paseo", "hub"] } },
                },
              },
            },
            {
              id: "work",
              if: "${{ values.selected_repo == 'hub' }}",
              environment: "runner",
              max_runtime: "10m",
              idle_timeout: "1m",
              agent: { provider: "codex" },
              prompt: [{ text: "Work" }],
            },
          ],
        },
      ],
    });

    assert.equal(configuration.triggers[0]?.steps.length, 2);
    assert.ok(configuration.triggers[0]?.values["selected_repo"]);
    assert.deepEqual(configuration.triggers[0]?.steps[0]?.output?.schema, {
      type: "object",
      additionalProperties: false,
      required: ["repo"],
      properties: { repo: { enum: ["paseo", "hub"] } },
    });
  });
});
