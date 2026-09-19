import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { ChannelIdentitiesSection } from "./channel-identities-section";

const boundary = vi.hoisted(() => ({
  identities: [] as unknown[],
  connections: [] as unknown[],
}));
// The Hub account and its reads are the network boundary; the directory join,
// the realm grouping and the rendered rows are production code.
vi.mock("../account-provider", () => ({
  useHubAccount: () => ({
    origin: "https://hub.example",
    signedIn: {
      account: { id: "user-alex" },
      organization: { id: "org" },
      membership: { id: "member-alex" },
    },
    api: () => ({
      get: async (path: string) =>
        path === "channel-identities"
          ? { identities: boundary.identities }
          : { connections: boundary.connections, providerApplications: [] },
    }),
  }),
}));
vi.mock("./channel-catalog-queries", () => ({
  useChannelCatalog: () => ({ entries: [], availability: "available", message: null }),
}));

afterEach(() => {
  cleanup();
  boundary.identities = [];
  boundary.connections = [];
});

function bot(id: string, account: string) {
  return {
    id,
    provider: "slack",
    providerApplicationId: null,
    name: `slack-${id}-t1`,
    externalName: "VeXeRe",
    status: "active",
    identityRealm: "slack:T1",
    identityRealmScope: "tenant",
    consumers: [{ resourceKind: "channel_account", resourceId: `slack/${account}`, name: account }],
  };
}

function identity(id: string, memberId: string, subject: string) {
  return {
    id,
    organizationId: "org",
    memberId,
    identityRealm: "slack:T1",
    connectionId: "a1",
    externalSubjectId: subject,
    displayName: null,
    verificationMethod: "channel_challenge",
    verifiedAt: "2026-09-17T00:00:00Z",
  };
}

it("lists the Member's own linked chat accounts on Account without opening Manage chat accounts", async () => {
  await page.viewport(1000, 700);
  boundary.connections = [bot("a1", "dai-clisbot"), bot("a2", "oai-clisbot")];
  boundary.identities = [
    identity("i1", "member-alex", "U8ZTVGJJF"),
    identity("i2", "member-sam", "USAM"),
  ];
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChannelIdentitiesSection pending={false} onManage={vi.fn()} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Account U8ZTVGJJF")).toBeTruthy();
  // One row for the workspace, naming every bot that recognizes the identity, never the realm id.
  expect(screen.getByText("Slack · VeXeRe · works with dai-clisbot, oai-clisbot")).toBeTruthy();
  // An administrator's read includes other Members; Account shows only your own.
  expect(screen.queryByText("Account USAM")).toBeNull();
  expect(screen.getByRole("button", { name: "Manage chat accounts" })).toBeTruthy();
  await page.screenshot({ path: "/tmp/account-channel-identities.png" });
});

it("says so when nothing is linked yet", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChannelIdentitiesSection pending={false} onManage={vi.fn()} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("No chat accounts are linked yet.")).toBeTruthy();
});
