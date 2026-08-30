import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import {
  buildBotManifest,
  buildBotStartPlan,
  buildRouteNote,
  planUnchanged,
  type BotStartOptions,
} from "./plan.js";
import type { BotManifest } from "./manifest.js";

const HOME = "/home/op/.clisbot";

function options(overrides: Partial<BotStartOptions> = {}): BotStartOptions {
  return { provider: "codex", ...overrides };
}

describe("buildBotStartPlan", () => {
  it("resolves the personal-assistant default name, account, and title", () => {
    const plan = buildBotStartPlan(options({ telegramBotToken: "tg-token", persist: true }), HOME);
    assert.equal(plan.name, "personal-assistant");
    assert.equal(plan.botType, "personal");
    assert.equal(plan.channel, "telegram");
    assert.equal(plan.account, "personal-assistant");
    assert.equal(plan.agentTitle, "personal-assistant");
    assert.equal(plan.provider, "codex");
    assert.equal(plan.model, undefined);
    assert.equal(plan.persist, true);
    assert.equal(plan.workspacePath, `${HOME}/workspaces/default`);
    assert.equal(plan.isolation, "local");
  });

  it("honors --bot-type team and the bot-name/account/agent-name overrides", () => {
    const plan = buildBotStartPlan(
      options({
        botType: "team",
        botName: "ops-bot",
        agentName: "Ops Agent",
        slackBotToken: "xoxb-1",
        slackAppToken: "xapp-1",
        slackAccount: "ops",
      }),
      HOME,
    );
    assert.equal(plan.name, "ops-bot");
    assert.equal(plan.botType, "team");
    assert.equal(plan.account, "ops");
    assert.equal(plan.agentTitle, "Ops Agent");
    assert.equal(plan.channel, "slack");
    assert.equal(plan.credential.secondary?.kind, "literal");
  });

  it("splits provider/model from the --provider slash form", () => {
    const plan = buildBotStartPlan(
      options({ provider: "codex/gpt-5.6-luna", telegramBotToken: "tg" }),
      HOME,
    );
    assert.equal(plan.provider, "codex");
    assert.equal(plan.model, "gpt-5.6-luna");
  });

  it("classifies a ${ENV_REF} token input", () => {
    const plan = buildBotStartPlan(
      options({ telegramBotToken: "${TELEGRAM_DEV_BOT_TOKEN}" }),
      HOME,
    );
    assert.deepEqual(plan.credential.input, { kind: "env", name: "TELEGRAM_DEV_BOT_TOKEN" });
  });

  it("defaults the account to the bot name when no channel account flag is given", () => {
    const plan = buildBotStartPlan(options({ botName: "my-bot", slackBotToken: "xoxb" }), HOME);
    assert.equal(plan.account, "my-bot");
  });

  it("requires a channel credential", () => {
    assert.throws(
      () => buildBotStartPlan(options({}), HOME),
      (error: unknown) => (error as { code?: string }).code === "MISSING_CREDENTIAL",
    );
  });

  it("rejects both channel credentials at once", () => {
    assert.throws(
      () => buildBotStartPlan(options({ slackBotToken: "xoxb", telegramBotToken: "tg" }), HOME),
      (error: unknown) => (error as { code?: string }).code === "MULTIPLE_CHANNELS",
    );
  });

  it("rejects an unknown --bot-type", () => {
    assert.throws(
      () => buildBotStartPlan(options({ botType: "solo", telegramBotToken: "tg" }), HOME),
      (error: unknown) => (error as { code?: string }).code === "INVALID_BOT_TYPE",
    );
  });

  it("rejects an unknown --new-workspace kind", () => {
    assert.throws(
      () => buildBotStartPlan(options({ newWorkspace: "pod", telegramBotToken: "tg" }), HOME),
      (error: unknown) => (error as { code?: string }).code === "INVALID_WORKSPACE",
    );
  });

  it("builds a channel-specific next-step note", () => {
    assert.match(
      buildRouteNote("slack", "ops", "Ops Agent"),
      /route matching account "ops" that targets agent "Ops Agent"/,
    );
  });
});

describe("planUnchanged", () => {
  function manifest(overrides: Partial<BotManifest> = {}): BotManifest {
    return {
      version: 1,
      name: "personal-assistant",
      botType: "personal",
      provider: "codex",
      workspacePath: `${HOME}/workspaces/default`,
      workspaceId: "ws-1",
      agentId: "ag-1",
      agentTitle: "personal-assistant",
      channel: "telegram",
      account: "personal-assistant",
      credentials: {},
      createdAt: "t0",
      updatedAt: "t0",
      ...overrides,
    };
  }

  it("is true when the flags are unchanged from the manifest", () => {
    const plan = buildBotStartPlan(options({ telegramBotToken: "tg" }), HOME);
    assert.equal(planUnchanged(manifest(), plan), true);
  });

  it("is false when the provider changes", () => {
    const plan = buildBotStartPlan(options({ provider: "claude", telegramBotToken: "tg" }), HOME);
    assert.equal(planUnchanged(manifest(), plan), false);
  });

  it("is false when the bot-type changes", () => {
    const plan = buildBotStartPlan(
      options({ botType: "team", botName: "personal-assistant", telegramBotToken: "tg" }),
      HOME,
    );
    assert.equal(planUnchanged(manifest(), plan), false);
  });

  it("is false when the model changes from none to a value", () => {
    const plan = buildBotStartPlan(options({ model: "gpt-5.6", telegramBotToken: "tg" }), HOME);
    assert.equal(planUnchanged(manifest(), plan), false);
  });
});

describe("buildBotManifest", () => {
  it("assembles the manifest with the credential record and route note", () => {
    const plan = buildBotStartPlan(options({ telegramBotToken: "tg", persist: true }), HOME);
    const manifest = buildBotManifest(plan, { workspaceId: "ws-1", agentId: "ag-1" });
    assert.equal(manifest.name, "personal-assistant");
    assert.equal(manifest.channel, "telegram");
    assert.equal(manifest.account, "personal-assistant");
    assert.equal(manifest.workspaceId, "ws-1");
    assert.equal(manifest.agentId, "ag-1");
    assert.deepEqual(manifest.credentials, {
      "telegram:personal-assistant": { persisted: true },
    });
  });
});
