import { expect, it, vi } from "vitest";
import { createHostRuntime } from "./loader/host.js";
import { createHostKeyedStoreRoot } from "./state/keyed-store.js";
import { createConversationMetadataResolver } from "./conversation-metadata.js";

it("coalesces provider reads, bounds cache size and expires both positive and negative facts", async () => {
  let now = 1_000;
  const state = createHostKeyedStoreRoot({ now: () => now });
  const runtime = createHostRuntime({ state, onInboundReply: async () => ({ dispatched: false }) });
  const lookup = vi.fn(async ({ to }: { to: string }) =>
    to === "missing"
      ? null
      : { label: `#${to}`, kind: "channel" as const, visibility: "private" as const },
  );
  const common = {
    channel: "slack",
    organizationId: "org",
    connectionId: "connection",
    accountId: "support",
    cfg: { token: "not-exposed" },
    runtime,
    lookup,
  };
  const resolve = createConversationMetadataResolver(common);
  await Promise.all(Array.from({ length: 10 }, () => resolve("C1")));
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(await resolve("C1")).toEqual({ label: "#C1", kind: "channel", visibility: "private" });
  await resolve("missing");
  await resolve("missing");
  expect(lookup).toHaveBeenCalledTimes(2);
  now += 60_001;
  await resolve("missing");
  expect(lookup).toHaveBeenCalledTimes(3);
  await createConversationMetadataResolver({ ...common, connectionId: "other" })("C1");
  await createConversationMetadataResolver({ ...common, cfg: { token: "rotated" } })("C1");
  await createConversationMetadataResolver({ ...common, organizationId: "other-org" })("C1");
  expect(lookup).toHaveBeenCalledTimes(6);
  now += 15 * 60_000;
  await resolve("C1");
  expect(lookup).toHaveBeenCalledTimes(7);
  for (let id = 0; id < 300; id++) await resolve(`C${id}`);
  expect(
    (
      await state
        .openKeyedStore({
          namespace: "slack.conversation-metadata",
          maxEntries: 256,
          defaultTtlMs: 15 * 60_000,
        })
        .entries()
    ).length,
  ).toBeLessThanOrEqual(256);
});

it("preserves an ID-only fallback without leaking provider failures", async () => {
  const lookup = vi.fn(async () => {
    throw new Error("https://api.telegram.org/botSECRET/getChat");
  });
  const resolve = createConversationMetadataResolver({
    channel: "telegram",
    organizationId: "org",
    connectionId: "connection",
    accountId: "support",
    cfg: {},
    runtime: createHostRuntime({ onInboundReply: async () => ({ dispatched: false }) }),
    lookup,
  });
  expect(await resolve("-123")).toBeNull();
  expect(await resolve("-123")).toBeNull();
  expect(lookup).toHaveBeenCalledTimes(1);
});
