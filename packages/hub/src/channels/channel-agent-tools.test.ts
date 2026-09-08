// The Hub's channel-tool bridge, driven by the REAL Feishu vertical's
// `plugin.agentTools` surface rather than a hand-written fake — the registrar
// under test is the Hub's own, and what it registers is whatever the ported
// `register*Tools` entry points actually register for the account's config.
//
// The three properties that matter here, and none of them can be asserted with a
// stub plugin:
//
//  * the tool list is the ACCOUNT'S list — a family the account disables is not
//    listed and cannot be called;
//  * authorization is re-resolved on every list and every call, so turning a
//    family off takes effect immediately without reloading the vertical;
//  * a capability on a channel whose vertical publishes no `agentTools` lists
//    nothing at all.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { feishuPlugin } from "@getpaseo/channels-feishu/dist/plugin.js";
import { discordPlugin } from "@getpaseo/channels-discord/dist/plugin.js";
import { zalouserPlugin } from "@getpaseo/channels-zalouser/dist/plugin.js";
import {
  agentToolContext,
  callChannelAgentTool,
  channelAgentToolNames,
  clearChannelAgentTools,
  isChannelAgentTool,
  listChannelAgentTools,
  registerChannelAgentTools,
} from "./channel-agent-tools.js";
import { registerChannelDriveConfig } from "./message-actions.js";
import type { ChannelReplyCapability } from "./channel-reply-capabilities.js";

const ACCOUNT_ID = "lark";
const ORGANIZATION_ID = "org";

const FEISHU = { organizationId: ORGANIZATION_ID, channel: "feishu", accountId: ACCOUNT_ID };
const DISCORD = { organizationId: ORGANIZATION_ID, channel: "discord", accountId: ACCOUNT_ID };
const ZALOUSER = { organizationId: ORGANIZATION_ID, channel: "zalouser", accountId: "personal" };

const CONTEXT = {
  ...FEISHU,
  conversation: { to: "oc_space", threadId: "om_root" },
  workspaceDir: "/tmp/project",
} as const;

/** The drive cfg the supervisor registers for the account (`accountAndCfg`). */
function driveConfig(account: Record<string, unknown> = {}): void {
  registerChannelDriveConfig(FEISHU, {
    channels: {
      feishu: {
        enabled: true,
        accounts: {
          [ACCOUNT_ID]: {
            appId: "cli_fusion_app",
            appSecret: "feishu-secret",
            connectionMode: "websocket",
            ...account,
          },
        },
      },
    },
  });
}

afterEach(() => {
  clearChannelAgentTools(FEISHU);
  clearChannelAgentTools({ ...FEISHU, organizationId: "other-org" });
  clearChannelAgentTools(DISCORD);
  clearChannelAgentTools(ZALOUSER);
  registerChannelDriveConfig(FEISHU, {});
  registerChannelDriveConfig(ZALOUSER, {});
});

describe("channel agent tools", () => {
  it("lists the vertical's tools for the account's enabled families", () => {
    registerChannelAgentTools(FEISHU, feishuPlugin as Record<string, unknown>);
    driveConfig();
    const names = listChannelAgentTools(CONTEXT).map((tool) => tool.name);
    assert.ok(names.includes("feishu_doc"), names.join(","));
    assert.ok(names.includes("feishu_chat"));
    assert.ok(names.includes("feishu_wiki"));
    assert.ok(names.includes("feishu_drive"));
    // `perm` is off by default upstream (`tools-config.ts`).
    assert.equal(names.includes("feishu_perm"), false);
    for (const tool of listChannelAgentTools(CONTEXT)) {
      assert.equal(typeof tool.description, "string");
      assert.equal(typeof tool.inputSchema, "object");
    }
  });

  it("re-resolves authorization on every list, without reloading the vertical", () => {
    registerChannelAgentTools(FEISHU, feishuPlugin as Record<string, unknown>);
    driveConfig({ tools: { perm: true } });
    assert.ok(listChannelAgentTools(CONTEXT).some((tool) => tool.name === "feishu_perm"));
    // The operator deploys a revision that turns the family back off. Nothing is
    // reloaded and nothing is invalidated: the next list simply re-collects.
    driveConfig({ tools: { perm: false, doc: false } });
    const names = new Set(listChannelAgentTools(CONTEXT).map((tool) => tool.name));
    assert.equal(names.has("feishu_perm"), false);
    assert.equal(names.has("feishu_doc"), false);
    assert.ok(names.has("feishu_chat"));
  });

  it("refuses a call to a tool the account's config does not register", async () => {
    registerChannelAgentTools(FEISHU, feishuPlugin as Record<string, unknown>);
    driveConfig({ tools: { perm: false } });
    // The name is one the vertical CAN register, so the MCP server routes it here…
    assert.equal(isChannelAgentTool(CONTEXT, "feishu_perm"), true);
    // …and the call is refused because this account's config does not.
    const outcome = await callChannelAgentTool(CONTEXT, "feishu_perm", {}, "call-1");
    assert.equal(outcome.ok, false);
    assert.match(outcome.ok ? "" : outcome.error, /does not currently offer/u);
  });

  it("mounts the Zalo Personal vertical's single tool for its account", () => {
    registerChannelAgentTools(ZALOUSER, zalouserPlugin as Record<string, unknown>);
    registerChannelDriveConfig(ZALOUSER, {
      channels: {
        zalouser: {
          enabled: true,
          accounts: { personal: { profile: "long-personal" } },
        },
      },
    });
    const context = { ...ZALOUSER, conversation: { to: "user:123" } };
    const tools = listChannelAgentTools(context);
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["zalouser"],
    );
    assert.equal(typeof tools[0]?.description, "string");
    assert.equal(isChannelAgentTool(context, "zalouser"), true);
  });

  it("lists nothing for a vertical that publishes no agent tools", () => {
    registerChannelAgentTools(DISCORD, discordPlugin as Record<string, unknown>);
    assert.deepEqual(channelAgentToolNames(DISCORD), []);
    assert.deepEqual(listChannelAgentTools({ ...DISCORD, conversation: { to: "1" } }), []);
  });

  it("lists nothing once the account's vertical is disposed", () => {
    registerChannelAgentTools(FEISHU, feishuPlugin as Record<string, unknown>);
    driveConfig();
    assert.ok(listChannelAgentTools(CONTEXT).length > 0);
    clearChannelAgentTools(FEISHU);
    assert.deepEqual(listChannelAgentTools(CONTEXT), []);
  });

  // One process serves every organization. Two tenants can name an account the
  // same; neither may see the other's registration.
  it("keeps one organization's registration out of another's", () => {
    registerChannelAgentTools(FEISHU, feishuPlugin as Record<string, unknown>);
    driveConfig();
    assert.ok(listChannelAgentTools(CONTEXT).length > 0);
    const foreign = { ...CONTEXT, organizationId: "other-org" };
    assert.deepEqual(listChannelAgentTools(foreign), []);
    assert.equal(isChannelAgentTool(foreign, "feishu_doc"), false);
    // And clearing the neighbour's registration leaves this one alone.
    clearChannelAgentTools({ ...FEISHU, organizationId: "other-org" });
    assert.ok(listChannelAgentTools(CONTEXT).length > 0);
  });

  it("takes the conversation from the capability, never from the model", () => {
    const capability = {
      organizationId: ORGANIZATION_ID,
      ref: {
        channel: "feishu",
        accountId: ACCOUNT_ID,
        externalConversationId: "oc_space",
        externalThreadId: "om_root",
      },
      projectRoot: "/tmp/project",
      requesterSenderId: "ou_requester",
    } as ChannelReplyCapability;
    assert.deepEqual(agentToolContext(capability), {
      ...FEISHU,
      conversation: { to: "oc_space", threadId: "om_root" },
      workspaceDir: "/tmp/project",
      // The inbound sender the capability was issued for: the ported executors
      // authorize against it, and it never comes from the model's arguments.
      requesterSenderId: "ou_requester",
    });
    // A capability bound to the conversation root carries no thread id.
    const rootCapability = {
      ref: { ...capability.ref, externalThreadId: null },
    } as ChannelReplyCapability;
    assert.deepEqual(agentToolContext(rootCapability).conversation, { to: "oc_space" });
  });
});
