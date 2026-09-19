import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { AccessPolicyError } from "../access/store.js";
import { compileHubConfig, compiledConfigurationHash } from "../config/compiler.js";
import { createMemoryDatabase } from "../db/memory.js";
import type { Database } from "../db/types.js";
import {
  createAutomationAuthorAccessCheck,
  type AutomationAuthorAccessCheckDependencies,
} from "./author-access.js";
import type { AutomationPausedInput } from "./paused-notice.js";

const ORGANIZATION_ID = "org";
const AUTHOR = { organizationId: ORGANIZATION_ID, userId: "lead", membershipId: "lead-membership" };

describe("automation author access re-check", () => {
  it("allows a run while the author can still delegate, and never pauses", async () => {
    const database = createMemoryDatabase({ organizationIds: [ORGANIZATION_ID] });
    const automation = await saveAutomation(database, "lead");
    const notices: AutomationPausedInput[] = [];
    const check = createAutomationAuthorAccessCheck(deps(database, notices, async () => undefined));

    const result = await check({
      organizationId: ORGANIZATION_ID,
      workflowId: automation.id,
      configurationRevisionId: automation.activeRevisionId,
    });

    assert.deepEqual(result, { allowed: true });
    assert.deepEqual(notices, []);
    assert.equal((await database.listOrganizationTriggers(ORGANIZATION_ID))[0]?.enabled, true);
  });

  it("pauses the Automation once when the author lost access, tells its Admins, and refuses later runs", async () => {
    const database = createMemoryDatabase({ organizationIds: [ORGANIZATION_ID] });
    const automation = await saveAutomation(database, "lead");
    const notices: AutomationPausedInput[] = [];
    const check = createAutomationAuthorAccessCheck(
      deps(database, notices, async () => {
        throw new AccessPolicyError("access_denied", "Access denied");
      }),
    );
    const input = {
      organizationId: ORGANIZATION_ID,
      workflowId: automation.id,
      configurationRevisionId: automation.activeRevisionId,
    };

    const first = await check(input);
    const second = await check(input);

    assert.equal(first.allowed, false);
    assert.equal(second.allowed, false);
    const paused = (await database.listOrganizationTriggers(ORGANIZATION_ID))[0];
    assert.equal(paused?.enabled, false);
    assert.match(paused?.pausedReason ?? "", /lost access to the Host, Project, or Agent/);
    assert.equal(notices.length, 1);
    assert.equal(notices[0]?.automation.id, automation.id);
    assert.equal(notices[0]?.authorUserId, "lead");
  });

  it("pauses when the author left the organization, and skips revisions without an author", async () => {
    const database = createMemoryDatabase({ organizationIds: [ORGANIZATION_ID] });
    const orphaned = await saveAutomation(database, "left");
    const imported = await saveAutomation(database, null);
    const notices: AutomationPausedInput[] = [];
    const check = createAutomationAuthorAccessCheck({
      ...deps(database, notices, async () => undefined),
      resolveAuthor: async () => undefined,
    });

    const orphanedResult = await check({
      organizationId: ORGANIZATION_ID,
      workflowId: orphaned.id,
      configurationRevisionId: orphaned.activeRevisionId,
    });
    const importedResult = await check({
      organizationId: ORGANIZATION_ID,
      workflowId: imported.id,
      configurationRevisionId: imported.activeRevisionId,
    });

    assert.equal(orphanedResult.allowed, false);
    assert.match(orphanedResult.allowed ? "" : orphanedResult.reason, /no longer a Member/);
    assert.deepEqual(importedResult, { allowed: true });
    assert.equal(notices.length, 1);
  });
});

function deps(
  database: Database,
  notices: AutomationPausedInput[],
  assertDelegation: AutomationAuthorAccessCheckDependencies["assertDelegation"],
): AutomationAuthorAccessCheckDependencies {
  return {
    database,
    resolveAuthor: async () => AUTHOR,
    assertDelegation,
    notifyPaused: async (input) => {
      notices.push(input);
    },
  };
}

async function saveAutomation(database: Database, createdByUserId: string | null) {
  const configuration = compileHubConfig({
    environments: [{ name: "runner", kind: "daemon", daemon: "runner", cwd: "/workspace" }],
    triggers: [
      {
        name: `handoff-${createdByUserId ?? "imported"}`,
        on: "manual.run",
        max_runtime: "1h",
        steps: [
          {
            id: "run",
            environment: "runner",
            max_runtime: "10m",
            idle_timeout: "1m",
            agent: { provider: "codex" },
            prompt: [{ text: "Do the work." }],
          },
        ],
      },
    ],
  });
  return database.saveOrganizationTrigger({
    organizationId: ORGANIZATION_ID,
    name: `handoff-${createdByUserId ?? "imported"}`,
    enabled: true,
    format: "workflow",
    yaml: "name: handoff",
    normalizedConfiguration: configuration,
    contentHash: compiledConfigurationHash(configuration),
    sourceKind: "manual",
    sourceEvidence: { kind: "test" },
    createdByUserId,
    routes: [],
  });
}
