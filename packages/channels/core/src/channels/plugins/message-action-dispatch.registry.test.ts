// upstream: src/channels/plugins/message-action-dispatch.registry.test.ts@5d8067a4483
// D-CORE-011: upstream drives this through the OpenClaw plugin runtime (a root
// registry plus a scoped gateway-request registry) to prove a scoped registration
// owns dispatch. Fusion installs one registry through
// `setChannelMessageToolPlugins`, so the scoped/root split has no Fusion meaning
// and is dropped; the read-authority assertions are upstream's, unchanged.
import { afterEach, describe, expect, it, vi } from "vitest";
import { setChannelMessageToolPlugins } from "./message-action-discovery.host-adapter.js";
import { dispatchChannelMessageAction } from "./message-action-dispatch.js";
import type { ChannelPlugin } from "./types.public.js";

const receipt = { content: [{ type: "text" as const, text: "delivered" }], details: { ok: true } };

afterEach(() => setChannelMessageToolPlugins([]));

function installPlugin(plugin: ChannelPlugin): void {
  setChannelMessageToolPlugins([plugin]);
}

describe("message action registration ownership", () => {
  it("returns null when the registered plugin declares no action handler", async () => {
    installPlugin({ id: "scoped-delivery" });
    expect(
      await dispatchChannelMessageAction({
        cfg: {},
        channel: "scoped-delivery",
        action: "send",
        params: { to: "recipient", message: "hello" },
      }),
    ).toBeNull();
  });

  it("dispatches a send to the registered plugin's handler", async () => {
    const handleAction = vi.fn(async () => receipt);
    installPlugin({ id: "scoped-delivery", actions: { describeMessageTool: () => null, handleAction } });
    expect(
      await dispatchChannelMessageAction({
        cfg: {},
        channel: "scoped-delivery",
        action: "send",
        params: { to: "recipient", message: "hello" },
      }),
    ).toEqual(receipt);
    expect(handleAction).toHaveBeenCalledTimes(1);
  });

  it("returns null for an unknown action name", async () => {
    const handleAction = vi.fn(async () => receipt);
    installPlugin({ id: "scoped-delivery", actions: { describeMessageTool: () => null, handleAction } });
    expect(
      await dispatchChannelMessageAction({
        cfg: {},
        channel: "scoped-delivery",
        action: "not-a-core-action",
        params: { to: "recipient" },
      }),
    ).toBeNull();
    expect(handleAction).not.toHaveBeenCalled();
  });

  it("declines an action the plugin does not support", async () => {
    const handleAction = vi.fn(async () => receipt);
    installPlugin({
      id: "scoped-delivery",
      actions: {
        describeMessageTool: () => null,
        supportsAction: ({ action }) => action !== "send",
        handleAction,
      },
    });
    expect(
      await dispatchChannelMessageAction({
        cfg: {},
        channel: "scoped-delivery",
        action: "send",
        params: { to: "recipient", message: "hello" },
      }),
    ).toBeNull();
    expect(handleAction).not.toHaveBeenCalled();
  });

  it("gates a delegated conversation read on the exact current conversation and account", async () => {
    const handleAction = vi.fn(async () => receipt);
    installPlugin({
      id: "scoped-delivery",
      actions: {
        describeMessageTool: () => null,
        providerOwnedReadGates: true,
        handleAction,
      },
    });
    const context = {
      cfg: {},
      channel: "scoped-delivery",
      action: "read",
      params: { to: "recipient" },
    } as const;

    // `providerOwnedReadGates` only delegates for bundled registrations, which is
    // every Fusion vertical, so a delegated read still needs the current context.
    await expect(
      dispatchChannelMessageAction({ ...context, conversationReadOrigin: "delegated" }),
    ).resolves.toEqual(receipt);

    installPlugin({
      id: "scoped-delivery",
      actions: { describeMessageTool: () => null, handleAction },
    });
    await expect(
      dispatchChannelMessageAction({ ...context, conversationReadOrigin: "delegated" }),
    ).rejects.toThrow("requires the exact current conversation and account");

    expect(
      await dispatchChannelMessageAction({
        ...context,
        conversationReadOrigin: "direct-operator",
      }),
    ).toEqual(receipt);
    expect(
      await dispatchChannelMessageAction({
        ...context,
        conversationReadOrigin: "delegated",
        accountId: "ops",
        requesterAccountId: "ops",
        toolContext: { currentChannelProvider: "scoped-delivery", currentChannelId: "recipient" },
      }),
    ).toEqual(receipt);
  });

  it("refuses a tool-driven action that requires a trusted sender identity", async () => {
    const handleAction = vi.fn(async () => receipt);
    installPlugin({
      id: "scoped-delivery",
      actions: {
        describeMessageTool: () => null,
        requiresTrustedRequesterSender: () => true,
        handleAction,
      },
    });
    await expect(
      dispatchChannelMessageAction({
        cfg: {},
        channel: "scoped-delivery",
        action: "send",
        params: { to: "recipient", message: "hello" },
      }),
    ).rejects.toThrow("Trusted sender identity is required");
    expect(handleAction).not.toHaveBeenCalled();
  });
});
