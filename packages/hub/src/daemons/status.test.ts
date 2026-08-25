import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { it } from "vitest";
import { daemonsQueryKey, refreshDaemons } from "./status.js";

it("separates daemon caches for accounts in the same organization", () => {
  assert.notDeepEqual(daemonsQueryKey("alice", "acme"), daemonsQueryKey("bob", "acme"));
});

it("refreshes an inactive daemon query before mutation settlement", async () => {
  const queryClient = new QueryClient();
  const queryKey = daemonsQueryKey("alice", "acme");
  let name = "Build Studio";
  await queryClient.fetchQuery({ queryKey, queryFn: () => Promise.resolve(name) });

  name = "Release Studio";
  await refreshDaemons(queryClient, "alice", "acme");

  assert.equal(queryClient.getQueryData(queryKey), "Release Studio");
});
