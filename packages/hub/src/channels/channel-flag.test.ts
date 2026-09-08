// COMPAT(clisbot-channels): the channel kill-switch, asserted end to end at the
// two surfaces that outlive a single slice — the organization-scoped management
// contract and the vertical loader.
//
// `PASEO_HUB_CHANNELS_ENABLED=0` (operator name `CLISBOT_HUB_CHANNELS_ENABLED`)
// must leave a Hub that boots with no channel tools, no channel endpoints and
// no channel verticals (`loader/channel-gate.ts`). The supervisor's own flag-off
// no-ops are pinned in `supervisor/supervisor.test.ts`; what that file cannot
// see is whether a resource ADDED later quietly answers with the plane off.
// Every channel function the management API routes to is listed here, so a new
// one is a failing test rather than a silent bypass.
//
// The database handle is a poison pill: it throws on any use. A gated function
// must reject BEFORE touching it, which is what "loads no channel supply" means
// — the check is not "returns 404", it is "did no work".
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { ProductRequestError } from "../auth/organization-access.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import type { Database } from "../db/types.js";
import { channelActivityPage, channelActivityView } from "../management-api/channel-activity.js";
import { channelCatalogView } from "../management-api/channel-catalog.js";
import {
  channelConfigurationRevisionList,
  channelControlPlaneView,
} from "../management-api/channel-plane-gate.js";
import {
  channelIngressListPage,
  channelIngressPrune,
  channelIngressResubmit,
  channelIngressStatusView,
} from "../management-api/channel-ingress.js";
import { channelAgentToolNames } from "./channel-agent-tools.js";
import { ChannelsDisabledError } from "./loader/channel-gate.js";
import { loadChannelVertical } from "./loader/load-channel.js";

const ORGANIZATION_ID = "flag-org";
const POISON = "the channel plane touched the database with the kill-switch off";

/** Fails loudly the moment a gated function reaches past its gate. */
const poison = {
  get() {
    return () => {
      throw new Error(POISON);
    };
  },
};
const poisonRuntime = new Proxy({} as DatabaseRuntime, poison);
const poisonDatabase = new Proxy({} as Database, poison);

/** Each channel resource the management API routes to, as a callable. */
const MANAGEMENT_RESOURCES: Record<string, () => unknown> = {
  "channel-catalog": () => channelCatalogView(),
  "channel-activity": () =>
    channelActivityPage(poisonRuntime, ORGANIZATION_ID, { limit: 25, channel: "slack" }),
  "channel-accounts/<id>/activity": () =>
    channelActivityView(poisonRuntime, ORGANIZATION_ID, "slack", "work"),
  // Every `channel-configuration` and `channel-accounts` branch starts from one
  // of these two reads (`management-api/index.ts`), including the per-account
  // `conversations`, `test-preview`, `retry` and `test` operations, which resolve
  // the account out of the snapshot before they do anything.
  "channel-configuration": () => channelControlPlaneView(poisonDatabase, ORGANIZATION_ID),
  "channel-configuration/revisions": () =>
    channelConfigurationRevisionList(poisonDatabase, ORGANIZATION_ID, 50),
  "channel-accounts/<id>/<operation>": () =>
    channelControlPlaneView(poisonDatabase, ORGANIZATION_ID),
  "channel-ingress": () => channelIngressStatusView(poisonRuntime, ORGANIZATION_ID),
  "channel-ingress/events": () =>
    channelIngressListPage(poisonRuntime, ORGANIZATION_ID, { limit: 25, offset: 0 }),
  "channel-ingress/resubmit": () => channelIngressResubmit(poisonRuntime, ORGANIZATION_ID, []),
  "channel-ingress/prune": () => channelIngressPrune(poisonRuntime, ORGANIZATION_ID, {}),
};

function withChannels(value: string | undefined): void {
  if (value === undefined) delete process.env["PASEO_HUB_CHANNELS_ENABLED"];
  else process.env["PASEO_HUB_CHANNELS_ENABLED"] = value;
}

/** The `not_found` an unrouted resource would have produced. */
function assertChannelsDisabled(error: unknown, resource: string): void {
  assert.ok(error instanceof ProductRequestError, `${resource} did not refuse`);
  assert.equal(error.message, "channels_disabled", resource);
  assert.equal(error.response().status, 404, resource);
}

afterEach(() => {
  withChannels(undefined);
});

describe("the channel kill-switch off", () => {
  it("answers not_found on every channel management resource, without a query", async () => {
    withChannels("0");
    for (const [resource, call] of Object.entries(MANAGEMENT_RESOURCES)) {
      let caught: unknown;
      try {
        await call();
      } catch (error) {
        caught = error;
      }
      assert.notEqual(caught, undefined, `${resource} answered with the plane off`);
      assertChannelsDisabled(caught, resource);
    }
  });

  it("refuses to load a vertical and mounts no channel agent tools", async () => {
    withChannels("0");
    await assert.rejects(
      loadChannelVertical({
        channel: "telegram",
        accountId: "personal",
        organizationId: ORGANIZATION_ID,
        installDir: "/nonexistent",
        mainInstallDir: "/nonexistent",
        channelInstallDir: "/nonexistent",
        entry: "index.js",
        plugin: { specifier: "index.js", exportName: "default" },
        loadMode: "in-repo",
        hostRuntime: {} as Parameters<typeof loadChannelVertical>[0]["hostRuntime"],
      }),
      ChannelsDisabledError,
    );
    // The agent-tools registry is filled by the loader (`registerChannelAgentTools`),
    // so a refused load leaves the account with no tools to hand an agent.
    assert.deepEqual(
      channelAgentToolNames({
        organizationId: ORGANIZATION_ID,
        channel: "telegram",
        accountId: "personal",
      }),
      [],
    );
  });
});

describe("the channel kill-switch on", () => {
  it("serves the catalog and lets every other resource reach the database", async () => {
    withChannels("1");
    const catalog = channelCatalogView();
    assert.ok(catalog.length > 0);
    assert.deepEqual(
      catalog.filter(({ id }) => id === "slack" || id === "telegram").map(({ id }) => id),
      ["slack", "telegram"],
    );

    // Everything else is a database read, so the poison pill firing IS the
    // proof that the gate — and only the gate — stood in the way.
    for (const [resource, call] of Object.entries(MANAGEMENT_RESOURCES)) {
      if (resource === "channel-catalog") continue;
      await assert.rejects(
        async () => await call(),
        (error: unknown) => error instanceof Error && error.message === POISON,
        resource,
      );
    }
  });

  it("lets the loader past the gate", async () => {
    withChannels("1");
    // The same call that answered `ChannelsDisabledError` with the plane off now
    // fails on the missing install instead: the gate is no longer the blocker.
    await assert.rejects(
      loadChannelVertical({
        channel: "telegram",
        accountId: "personal",
        organizationId: ORGANIZATION_ID,
        installDir: "/nonexistent",
        mainInstallDir: "/nonexistent",
        channelInstallDir: "/nonexistent",
        entry: "index.js",
        plugin: { specifier: "index.js", exportName: "default" },
        loadMode: "in-repo",
        hostRuntime: {} as Parameters<typeof loadChannelVertical>[0]["hostRuntime"],
      }),
      (error: unknown) => error instanceof Error && !(error instanceof ChannelsDisabledError),
    );
  });
});
