// upstream: src/channels/plugins/message-actions.test.ts@5d8067a4483
// Message action tests cover channel message action schema and invocation behavior.
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
// D-CORE-011: the OpenClaw plugin runtime registry (`plugins/runtime.ts`,
// `prepared-message-tool-catalog.ts`, `runtime.ts`, `test-utils/channel-plugins.ts`)
// is replaced by the discovery host adapter's explicit registry. Assertions are
// unchanged; only registration is.
import {
  buildPreparedMessageToolCatalog,
  defaultRuntime,
  getPreparedMessageToolCatalog,
  setChannelMessageToolPlugins,
  setPreparedMessageToolCatalog,
} from "./message-action-discovery.host-adapter.js";
import {
  channelSupportsMessageCapability,
  channelSupportsMessageCapabilityForChannel,
  listCrossChannelSchemaSupportedMessageActions,
  resolveChannelMessageToolMediaSourceParamKeys,
  resolveChannelMessageToolSchemaProperties,
} from "./message-action-discovery.js";
import type { ChannelMessageCapability } from "./message-capabilities.js";
import type {
  ChannelMessageActionAdapter,
  ChannelMessageToolSchemaContribution,
  ChannelPlugin,
} from "./types.public.js";

function setActivePluginRegistry(plugins: readonly ChannelPlugin[]): void {
  setChannelMessageToolPlugins(plugins);
  setPreparedMessageToolCatalog(
    plugins.length === 0 ? undefined : buildPreparedMessageToolCatalog(plugins),
  );
}

function createChannelTestPluginBase(params: { id: string }): ChannelPlugin {
  return { id: params.id };
}

const emptyRegistry: readonly ChannelPlugin[] = [];
const EMPTY_PREPARED_MESSAGE_TOOL_CATALOG = {
  version: 0,
  channels: [],
  getChannel: () => undefined,
};

function createMessageActionsPlugin(params: {
  id: string;
  aliases?: string[];
  capabilities: ChannelMessageCapability[];
}): ChannelPlugin {
  const base = createChannelTestPluginBase({ id: params.id });
  return {
    ...base,
    ...(params.aliases ? { meta: { aliases: params.aliases } } : {}),
    actions: {
      describeMessageTool: () => ({
        actions: ["send"],
        capabilities: params.capabilities,
      }),
    },
  };
}

const buttonsPlugin = createMessageActionsPlugin({
  id: "demo-buttons",
  capabilities: ["presentation"],
});
const cardsPlugin = createMessageActionsPlugin({
  id: "demo-cards",
  capabilities: ["delivery-pin"],
});

function activateMessageActionTestRegistry(): void {
  setActivePluginRegistry([buttonsPlugin, cardsPlugin]);
}

function activateDiscoveredMessageActionPlugin(params: {
  id: string;
  label: string;
  describeMessageTool: ChannelMessageActionAdapter["describeMessageTool"];
}): void {
  const plugin: ChannelPlugin = {
    ...createChannelTestPluginBase({ id: params.id }),
    actions: { describeMessageTool: params.describeMessageTool },
  };
  void params.label;
  setActivePluginRegistry([plugin]);
}

describe("message action capability checks", () => {
  const errorSpy = vi.spyOn(defaultRuntime, "error").mockImplementation(() => undefined);

  afterEach(() => {
    setActivePluginRegistry(emptyRegistry);
    errorSpy.mockClear();
  });

  it("aggregates capabilities across plugins", () => {
    activateMessageActionTestRegistry();
    expect(channelSupportsMessageCapability({}, "presentation")).toBe(true);
    expect(channelSupportsMessageCapability({}, "delivery-pin")).toBe(true);
  });

  it("does not replace an explicitly empty prepared channel catalog", () => {
    activateMessageActionTestRegistry();
    const cfg = {};
    expect(
      channelSupportsMessageCapability(cfg, "presentation", EMPTY_PREPARED_MESSAGE_TOOL_CATALOG),
    ).toBe(false);
    expect(
      resolveChannelMessageToolSchemaProperties({
        cfg,
        channel: "demo-buttons",
        preparedMessageToolCatalog: EMPTY_PREPARED_MESSAGE_TOOL_CATALOG,
      }),
    ).toEqual({});
  });

  it("evaluates prepared discovery against each account context", () => {
    const base = createChannelTestPluginBase({ id: "demo-account-scoped" });
    const plugin: ChannelPlugin = {
      ...base,
      actions: {
        describeMessageTool: ({ accountId }) => ({
          actions: ["send"],
          capabilities: accountId === "first" ? ["presentation"] : ["delivery-pin"],
        }),
      },
    };
    setActivePluginRegistry([plugin]);
    const preparedMessageToolCatalog = getPreparedMessageToolCatalog();
    const cfg = {};
    const supportsAccountCapability = (
      accountId: string,
      capability: ChannelMessageCapability,
    ): boolean =>
      channelSupportsMessageCapabilityForChannel(
        { cfg, channel: plugin.id, accountId, preparedMessageToolCatalog },
        capability,
      );
    expect(supportsAccountCapability("first", "presentation")).toBe(true);
    expect(supportsAccountCapability("second", "presentation")).toBe(false);
    expect(supportsAccountCapability("second", "delivery-pin")).toBe(true);
  });

  it("checks per-channel capabilities", () => {
    activateMessageActionTestRegistry();
    const cfg = {};
    const supportsCapability = (
      channel: string | undefined,
      capability: ChannelMessageCapability,
    ): boolean => channelSupportsMessageCapabilityForChannel({ cfg, channel }, capability);
    expect(supportsCapability("demo-buttons", "presentation")).toBe(true);
    expect(supportsCapability("demo-cards", "presentation")).toBe(false);
    expect(supportsCapability("demo-buttons", "delivery-pin")).toBe(false);
    expect(supportsCapability("demo-cards", "delivery-pin")).toBe(true);
    expect(supportsCapability(undefined, "delivery-pin")).toBe(false);
  });

  it("normalizes channel aliases for per-channel capability checks", () => {
    const plugin = createMessageActionsPlugin({
      id: "demo-cards",
      aliases: ["demo-cards-alias"],
      capabilities: ["delivery-pin"],
    });
    setActivePluginRegistry([plugin]);
    expect(
      channelSupportsMessageCapabilityForChannel(
        { cfg: {}, channel: "demo-cards-alias" },
        "delivery-pin",
      ),
    ).toBe(true);
  });

  it("uses unified message tool discovery for actions, capabilities, and schema", () => {
    activateDiscoveredMessageActionPlugin({
      id: "demo-unified",
      label: "Demo Unified",
      describeMessageTool: () => ({
        actions: ["react"],
        capabilities: ["presentation"],
        schema: {
          properties: {
            components: Type.Array(Type.String()),
          },
        },
      }),
    });
    expect(channelSupportsMessageCapability({}, "presentation")).toBe(true);
    expect(
      resolveChannelMessageToolSchemaProperties({
        cfg: {},
        channel: "demo-unified",
      }),
    ).toHaveProperty("components");
  });

  it("keeps all-configured schema account-neutral from another current channel", () => {
    const schema: ChannelMessageToolSchemaContribution[] = [
      {
        actions: ["react"],
        properties: { emoji: Type.Optional(Type.String()) },
      },
      {
        actions: ["send"],
        properties: { components: Type.Optional(Type.Object({})) },
        visibility: "all-configured",
      },
    ];
    activateDiscoveredMessageActionPlugin({
      id: "discord",
      label: "Discord",
      describeMessageTool: ({ accountId }) =>
        accountId
          ? { actions: [], schema: null }
          : {
              actions: ["react", "send"],
              schema,
            },
    });
    const properties = resolveChannelMessageToolSchemaProperties({
      cfg: {},
      channel: "slack",
      accountId: "slack-workspace",
    });
    expect(properties).toHaveProperty("components");
    expect(properties).not.toHaveProperty("emoji");
  });

  it("keeps contributed schema properties optional so only action stays required", () => {
    activateDiscoveredMessageActionPlugin({
      id: "demo-contrib",
      label: "Demo Contrib",
      describeMessageTool: () => ({
        actions: ["send"],
        schema: {
          properties: {
            // Non-optional TypeBox schema: plugin forgot Type.Optional.
            components: Type.Array(Type.String()),
            // Cloning strips typebox's non-enumerable `~optional` marker;
            // mirrors serialized/external plugin contributions.
            chatRef: structuredClone(Type.Optional(Type.String())),
            media: Type.Optional(Type.String()),
          },
        },
      }),
    });
    const properties = resolveChannelMessageToolSchemaProperties({
      cfg: {},
      channel: "demo-contrib",
    });
    // Regression: required leakage made every message tool call fail validation
    // with "must have required properties chatRef, media, ...".
    const toolSchema = Type.Object({ action: Type.String(), ...properties });
    expect(toolSchema.required).toEqual(["action"]);
  });

  it("filters only actions that depend on current-channel-only schema", () => {
    activateDiscoveredMessageActionPlugin({
      id: "demo-scoped-schema",
      label: "Demo Scoped Schema",
      describeMessageTool: () => ({
        actions: ["read", "list-pins", "unpin"],
        schema: {
          actions: ["unpin"],
          properties: {
            pinnedMessageId: Type.Optional(Type.String()),
          },
        },
      }),
    });
    expect(
      listCrossChannelSchemaSupportedMessageActions({
        cfg: {},
        channel: "demo-scoped-schema",
      }),
    ).toEqual(["read", "list-pins"]);
  });

  it("keeps unscoped current-channel schema conservative for cross-channel actions", () => {
    activateDiscoveredMessageActionPlugin({
      id: "demo-unscoped-schema",
      label: "Demo Unscoped Schema",
      describeMessageTool: () => ({
        actions: ["read", "unpin"],
        schema: {
          properties: {
            pinnedMessageId: Type.Optional(Type.String()),
          },
        },
      }),
    });
    expect(
      listCrossChannelSchemaSupportedMessageActions({
        cfg: {},
        channel: "demo-unscoped-schema",
      }),
    ).toStrictEqual([]);
  });

  it("treats empty current-channel schema action lists as blocking no cross-channel actions", () => {
    activateDiscoveredMessageActionPlugin({
      id: "demo-empty-scoped-schema",
      label: "Demo Empty Scoped Schema",
      describeMessageTool: () => ({
        actions: ["read", "list-pins"],
        schema: {
          actions: [],
          properties: {
            optionalChannelOnlyValue: Type.Optional(Type.String()),
          },
        },
      }),
    });
    expect(
      listCrossChannelSchemaSupportedMessageActions({
        cfg: {},
        channel: "demo-empty-scoped-schema",
      }),
    ).toEqual(["read", "list-pins"]);
  });

  it("derives plugin-owned media-source params for the current action", () => {
    activateDiscoveredMessageActionPlugin({
      id: "demo-media",
      label: "Demo Media",
      describeMessageTool: () => ({
        actions: ["send", "set-profile"],
        mediaSourceParams: {
          "set-profile": ["avatarUrl", "avatarPath"],
        },
        schema: {
          properties: {
            avatarUrl: Type.Optional(Type.String({ description: "Remote avatar URL" })),
            avatarPath: Type.Optional(Type.String({ description: "Local avatar path" })),
            displayName: Type.Optional(Type.String()),
          },
        },
      }),
    });
    expect(
      resolveChannelMessageToolMediaSourceParamKeys({
        cfg: {},
        action: "set-profile",
        channel: "demo-media",
      }),
    ).toEqual(["avatarUrl", "avatarPath"]);
    expect(
      resolveChannelMessageToolMediaSourceParamKeys({
        cfg: {},
        action: "send",
        channel: "demo-media",
      }),
    ).toStrictEqual([]);
  });

  it("keeps flat media-source param discovery for backward compatibility", () => {
    activateDiscoveredMessageActionPlugin({
      id: "demo-media-flat",
      label: "Demo Media Flat",
      describeMessageTool: () => ({
        actions: ["set-profile"],
        mediaSourceParams: ["avatarUrl", "avatarPath"],
      }),
    });
    expect(
      resolveChannelMessageToolMediaSourceParamKeys({
        cfg: {},
        action: "set-profile",
        channel: "demo-media-flat",
      }),
    ).toEqual(["avatarUrl", "avatarPath"]);
  });

  it("skips crashing action/capability discovery paths and logs once", () => {
    activateDiscoveredMessageActionPlugin({
      id: "demo-crashing",
      label: "Demo Crashing",
      describeMessageTool: () => {
        throw new Error("boom");
      },
    });
    expect(channelSupportsMessageCapability({}, "presentation")).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(channelSupportsMessageCapability({}, "presentation")).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
