import { expect, test } from "vitest";
import { templateConfigProblem, snapshotStart } from "./start-template";
const entries = [
  {
    provider: "mock",
    status: "ready" as const,
    enabled: true,
    models: [
      {
        provider: "mock",
        id: "fast",
        label: "Fast",
        thinkingOptions: [{ id: "high", label: "High" }],
      },
    ],
    modes: [{ id: "safe", label: "Safe" }],
  },
];
test("configured templates reject missing provider, model, effort and permission mode", () => {
  expect(
    templateConfigProblem(
      { provider: "mock", model: "fast", thinkingOptionId: "high", modeId: "safe" },
      entries,
    ),
  ).toBeNull();
  for (const config of [
    { provider: "gone" },
    { provider: "mock", model: "gone" },
    { provider: "mock", modeId: "gone" },
    { provider: "mock", model: "fast", thinkingOptionId: "gone" },
  ])
    expect(templateConfigProblem(config, entries)).not.toBeNull();
});
test("a worktree template retains a fixed ref and does not capture a generated worktree name", () => {
  const result = snapshotStart(
    { kind: "project", projectId: "p1", workspace: { kind: "local" } },
    "fix",
    null,
    "worktree",
    {
      kind: "branch",
      name: "main",
      refName: "refs/remotes/origin/main",
      accessibilityLabel: "main",
    },
  );
  expect(result.target).toEqual({
    kind: "project",
    projectId: "p1",
    workspace: { kind: "worktree", base: { kind: "ref", refName: "refs/remotes/origin/main" } },
  });
});
