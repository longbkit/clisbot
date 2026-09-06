import { expect, it } from "vitest";
import { createMemoryDatabase } from "../db/memory.js";
import { automationRunView } from "./automation-run.js";

it("shows run and step outcomes without exposing execution inputs or another Automation", async () => {
  const database = createMemoryDatabase();
  const { run } = await database.createAcceptedTriggerRun({
    organizationId: "org",
    workflowId: "automation",
    configurationRevisionId: "revision",
    providerEventReceiptId: "receipt",
    configuredTriggerName: "manual",
    prompt: "private prompt",
    inputs: { secret: "private input" },
    triggerContext: { token: "private token" },
    outputContext: { credential: "private credential" },
    deadlineAt: new Date("2026-09-05T04:00:00Z"),
    createdAt: new Date("2026-09-05T03:00:00Z"),
    stepIds: ["run"],
  });
  const view = await automationRunView(database, "org", "automation", run.id);
  expect(view).toEqual({
    id: run.id,
    status: "running",
    revisionId: "revision",
    createdAt: "2026-09-05T03:00:00.000Z",
    completedAt: null,
    error: null,
    steps: [
      {
        id: expect.any(String),
        name: "run",
        status: "pending",
        startedAt: null,
        completedAt: null,
        error: null,
        outputs: {},
      },
    ],
  });
  expect(await automationRunView(database, "other-org", "automation", run.id)).toBeUndefined();
  expect(await automationRunView(database, "org", "other-automation", run.id)).toBeUndefined();
  expect(await automationRunView(database, "org", "automation", "missing")).toBeUndefined();
});
