import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { planWorkspaceAction } from "./paseo-workspace.mjs";

const config = JSON.parse(readFileSync(new URL("../paseo.json", import.meta.url), "utf8"));
const workspace = { host: "127.0.0.1", port: "4321", workspacePath: "/tmp/workspace" };

test("a workspace's app service runs the development server", () => {
  assert.equal(config.scripts.app.command, "node ./scripts/paseo-workspace.mjs dev");
});

test("the evidence service is separately named, so nothing starts it by accident", () => {
  assert.equal(config.scripts.evidence.command, "node ./scripts/paseo-workspace.mjs evidence");
  assert.notEqual(config.scripts.app.command, config.scripts.evidence.command);
});

test("dev serves the checkout on the assigned port with the configuration it already has", () => {
  const plan = planWorkspaceAction("dev", workspace);
  assert.equal(plan.command, "npm");
  assert.deepEqual(plan.args, ["run", "dev", "--", "--host", "127.0.0.1", "--port", "4321"]);
  assert.deepEqual(plan.environment, { PASEO_HUB_APP_URL: "http://127.0.0.1:4321" });
  assert.equal(plan.build, false);
});

test("dev takes its app URL from the workspace when Paseo published one", () => {
  const plan = planWorkspaceAction("dev", { ...workspace, appUrl: "https://workspace.example" });
  assert.deepEqual(plan.environment, { PASEO_HUB_APP_URL: "https://workspace.example" });
});

test("dev never builds, never redirects the data directory, and never blanks configuration", () => {
  const { environment, build } = planWorkspaceAction("dev", workspace);
  assert.equal(build, false);
  assert.equal("PASEO_HUB_DATA_DIR" in environment, false);
  for (const name of ["DATABASE_URL", "GITHUB_APP_ID", "SLACK_CLIENT_ID", "DISCORD_BOT_TOKEN"]) {
    assert.equal(name in environment, false, `dev must leave ${name} alone`);
  }
});

test("evidence is its own action and is never what dev runs", () => {
  const dev = planWorkspaceAction("dev", workspace);
  const evidence = planWorkspaceAction("evidence", workspace);
  assert.notDeepEqual(dev, evidence);
  assert.equal(evidence.build, true);
  assert.deepEqual(evidence.args, ["dist/index.js"]);
  assert.equal(
    evidence.environment.PASEO_HUB_DATA_DIR,
    "/tmp/workspace/.dev/operator-app-evidence/runtime",
  );
  for (const name of ["DATABASE_URL", "GITHUB_APP_ID", "SLACK_CLIENT_ID", "DISCORD_BOT_TOKEN"]) {
    assert.equal(evidence.environment[name], "", `evidence must start with no ${name}`);
  }
});

test("an unknown action is refused rather than guessed at", () => {
  assert.throws(() => planWorkspaceAction("serve", workspace), /Expected one of/u);
});
