import { expect, it, vi } from "vitest";
import { configuredChannelDestinations } from "./configured-destinations.js";
import { createConversationMetadataResolver } from "./conversation-metadata.js";
import { createHostRuntime } from "./loader/host.js";

it("bounds uncached lookup work while allowing later configured destinations to resolve on refresh", async () => {
  const lookup = vi.fn(async ({ to }: { to: string }) => ({
    label: `#${to}`,
    kind: "channel" as const,
    visibility: "public" as const,
  }));
  const resolve = createConversationMetadataResolver({
    channel: "slack",
    organizationId: "org",
    connectionId: "connection",
    accountId: "support",
    cfg: {},
    runtime: createHostRuntime({ onInboundReply: async () => ({ dispatched: false }) }),
    lookup,
  });
  const account = {
    routes: [
      { match: { kind: "channel" as const, ids: Array.from({ length: 35 }, (_, i) => `C${i}`) } },
    ],
  };
  const first = await configuredChannelDestinations(account, [], resolve);
  expect(lookup).toHaveBeenCalledTimes(20);
  expect(first.filter(({ source }) => source === "provider")).toHaveLength(20);
  const second = await configuredChannelDestinations(account, [], resolve);
  expect(lookup).toHaveBeenCalledTimes(35);
  expect(second.every(({ source }) => source === "provider")).toBe(true);
});

it("never invents a topic parent or treats group titles as topic titles", async () => {
  const resolve = vi.fn(async (_id: string) => ({
    label: "Support forum",
    kind: "group" as const,
    visibility: "unknown" as const,
  }));
  const account = { routes: [{ match: { kind: "topic" as const, ids: ["42", "unknown-topic"] } }] };
  const rows = await configuredChannelDestinations(
    account,
    [
      {
        id: "42",
        kind: "topic",
        rootConversationId: "-123",
        threadId: "42",
        label: "previous group name",
        visibility: "unknown",
        observedAt: new Date(),
      },
    ],
    resolve,
  );
  expect(rows).toEqual([
    {
      id: "42",
      kind: "topic",
      rootConversationId: "-123",
      threadId: "42",
      label: "Support forum",
      visibility: "unknown",
      source: "provider",
    },
  ]);
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(resolve.mock.calls[0]?.[0]).toBe("-123");
});
