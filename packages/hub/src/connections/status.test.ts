import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { it } from "vitest";
import { connectionsQueryKey, refreshConnections } from "./status.js";

it("separates connection caches for accounts in the same organization", () => {
  assert.notDeepEqual(connectionsQueryKey("alice", "acme"), connectionsQueryKey("bob", "acme"));
});

it("refreshes an inactive connection query before mutation settlement", async () => {
  const queryClient = new QueryClient();
  const queryKey = connectionsQueryKey("alice", "acme");
  let status = "connected";
  await queryClient.fetchQuery({ queryKey, queryFn: () => Promise.resolve(status) });

  status = "disconnected";
  await refreshConnections(queryClient, "alice", "acme");

  assert.equal(queryClient.getQueryData(queryKey), "disconnected");
});
