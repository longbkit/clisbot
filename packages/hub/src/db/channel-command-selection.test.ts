import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { embeddedDatabaseRuntime } from "./runtime/index.js";
import * as schema from "./schema.js";
import { ChannelAccessStore } from "./channel-access.js";

it("persists account commands and independent selection axes across restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "hub-channel-commands-"));
  let { runtime } = await embeddedDatabaseRuntime(root);
  try {
    await runtime.migrate();
    await runtime
      .drizzle()
      .insert(schema.organizations)
      .values([
        { id: "org", name: "Org", slug: "org" },
        { id: "other", name: "Other", slug: "other" },
      ]);
    let store = new ChannelAccessStore(runtime.drizzle());
    const account = { organizationId: "org", channel: "slack" as const, accountId: "support" };
    const key = { ...account, externalConversationId: "C1", externalThreadId: null };
    await store.setCommand(account, {
      name: "review",
      prompt: "Review the code",
      updatedBy: "slack:U1",
    });
    await store.setCommand(account, {
      name: "review",
      prompt: "Review the changes",
      updatedBy: "slack:U2",
    });
    expect((await store.listCommands(account)).map(({ name }) => name)).toEqual(["review"]);
    for (const changed of [
      { organizationId: "other" },
      { channel: "telegram" as const },
      { accountId: "other" },
    ]) {
      expect(await store.findCommand({ ...account, ...changed }, "review")).toBeUndefined();
      expect(await store.removeCommand({ ...account, ...changed }, "review")).toBe(false);
    }
    await expect(
      store.setCommand(account, { name: "bad name", prompt: "x", updatedBy: "U1" }),
    ).rejects.toThrow("Invalid command name");
    await expect(
      store.setCommand(account, { name: "empty", prompt: " ", updatedBy: "U1" }),
    ).rejects.toThrow("must not be empty");
    await Promise.all([
      store.setConversationSelection(key, {
        selectedProvider: "codex",
        selectedModel: "model-a",
        selectedBy: "U1",
      }),
      store.setConversationSelection(key, {
        selectedThinkingOption: "high",
        selectedMode: "default",
        selectedFeatureValues: { fast: true },
        selectedBy: "U2",
      }),
    ]);
    const claimed = await Promise.all([
      store.beginCommand(key, "message-pending", "fork"),
      store.beginCommand(key, "message-pending", "fork"),
    ]);
    expect(claimed.filter((receipt) => receipt.claimed)).toHaveLength(1);
    expect(claimed.every((receipt) => receipt.status === "pending")).toBe(true);
    expect(await store.beginCommand(key, "message-completed", "new")).toEqual({
      claimed: true,
      status: "pending",
    });
    await store.completeCommand(key, "message-completed", {
      handled: false,
      detail: "Daemon unavailable",
    });
    // Completion is immutable even when a delayed writer retries its result.
    await store.completeCommand(key, "message-completed", { handled: true, detail: "Changed" });
    await runtime.close();
    ({ runtime } = await embeddedDatabaseRuntime(root));
    store = new ChannelAccessStore(runtime.drizzle());
    expect(await store.beginCommand(key, "message-pending", "fork")).toEqual({
      claimed: false,
      status: "pending",
    });
    expect(await store.beginCommand(key, "message-completed", "quick")).toEqual({
      claimed: false,
      status: "completed",
      handled: false,
      detail: "Daemon unavailable",
    });
    expect(
      await store.beginCommand({ ...key, externalConversationId: "C2" }, "message-pending", "fork"),
    ).toEqual({ claimed: true, status: "pending" });
    expect(await store.findCommand(account, "review")).toMatchObject({
      prompt: "Review the changes",
      updatedBy: "slack:U2",
    });
    expect(await store.findConversationSelection(key)).toMatchObject({
      selectedProvider: "codex",
      selectedModel: "model-a",
      selectedThinkingOption: "high",
      selectedMode: "default",
      selectedFeatureValues: { fast: true },
    });
    expect(
      await store.setConversationSelection(key, { selectedThinkingOption: null, selectedBy: "U1" }),
    ).toMatchObject({
      selectedProvider: "codex",
      selectedModel: "model-a",
      selectedThinkingOption: null,
      selectedMode: "default",
      selectedFeatureValues: { fast: true },
    });
    expect(await store.removeCommand(account, "review")).toBe(true);
    expect(await store.listCommands(account)).toEqual([]);
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
