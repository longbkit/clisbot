import { expect, it } from "vitest";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { acceptedChatRecord } from "./use-chat-record";
import { chatView } from "../data/contracts";
import type { AggregatedQueryResult } from "../data/use-aggregated-query";
import type { ChatPayload as CatalogChat } from "../data/contracts";
function catalog(): AggregatedQueryResult<CatalogChat> {
  const record = {
    id: "chat",
    title: "Accepted",
    participants: [],
    archivedAt: null,
  } as unknown as ChatPayload;
  return {
    loadState: {
      status: "loaded",
      data: [{ ...chatView(record), serverId: "host", serverName: "Host" }],
    },
    acceptedServerIds: ["host"],
    hostErrors: [],
    isError: false,
    error: null,
    refetch() {},
    isRefetching: true,
  };
}
it("reuses only the canonical record accepted for this exact Host/chat during background refresh", () => {
  const c = catalog();
  expect(acceptedChatRecord(c, "host", "chat")?.title).toBe("Accepted");
  expect(acceptedChatRecord(c, "other", "chat")).toBeNull();
  expect(acceptedChatRecord(c, "host", "other")).toBeNull();
});
it("does not seed pending/new-admission, failed, unasked, removed or archived records", () => {
  expect(
    acceptedChatRecord({ ...catalog(), loadState: { status: "loading" } }, "host", "chat"),
  ).toBeNull();
  expect(acceptedChatRecord({ ...catalog(), acceptedServerIds: [] }, "host", "chat")).toBeNull();
  expect(acceptedChatRecord({ ...catalog(), isError: true }, "host", "chat")).toBeNull();
  expect(
    acceptedChatRecord(
      { ...catalog(), hostErrors: [{ serverId: "host", serverName: "Host", message: "denied" }] },
      "host",
      "chat",
    ),
  ).toBeNull();
  expect(
    acceptedChatRecord({ ...catalog(), loadState: { status: "loaded", data: [] } }, "host", "chat"),
  ).toBeNull();
  const c = catalog();
  if (c.loadState.status === "loaded") c.loadState.data[0]!.record!.archivedAt = "now";
  expect(acceptedChatRecord(c, "host", "chat")).toBeNull();
});
