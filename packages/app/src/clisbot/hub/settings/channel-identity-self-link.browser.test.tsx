import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { ChannelIdentitySelfLinkSettings } from "./channel-identity-settings";

const boundary = vi.hoisted(() => ({
  requestedConnectionId: undefined as string | undefined,
  identities: [] as unknown[],
  connections: [] as unknown[],
  post: vi.fn(),
}));
// Routing, the Hub reads and the catalog are boundaries; the form's realm
// filtering, selection and feedback are production code.
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ channelConnectionId: boundary.requestedConnectionId }),
}));
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
      post: boundary.post,
    }),
  }),
}));
vi.mock("./channel-catalog-queries", () => ({
  useChannelCatalog: () => ({ entries: [], availability: "available", message: null }),
}));
// The native picker opens a sheet; a plain select exposes its options and empty text.
vi.mock("@/components/ui/select-field", () => ({
  SelectField: ({
    label,
    value,
    onChange,
    options,
    emptyText,
  }: {
    label: string;
    value: string | null;
    onChange(value: string): void;
    options: { id: string; value: string; label: string }[];
    emptyText: string;
  }) => {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value),
      [onChange],
    );
    return (
      <div>
        <select aria-label={label} value={value ?? ""} onChange={change}>
          <option value="">Choose</option>
          {options.map((option) => (
            <option key={option.id} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {options.length === 0 ? <p>{emptyText}</p> : null}
      </div>
    );
  },
}));

afterEach(() => {
  cleanup();
  boundary.requestedConnectionId = undefined;
  boundary.identities = [];
  boundary.connections = [];
  boundary.post.mockReset();
});

function bot(id: string, account: string, team: string) {
  return {
    id,
    provider: "slack",
    providerApplicationId: null,
    name: `slack-${id}-${team.toLowerCase()}`,
    externalName: team === "T1" ? "VeXeRe" : "Other",
    status: "active",
    identityRealm: `slack:${team}`,
    canLinkIdentity: true,
    consumers: [{ resourceKind: "channel_account", resourceId: `slack/${account}`, name: account }],
  };
}

function linked(team: string) {
  return {
    id: `identity-${team}`,
    organizationId: "org",
    memberId: "member-alex",
    identityRealm: `slack:${team}`,
    connectionId: team === "T1" ? "a1" : "b1",
    externalSubjectId: "U8ZTVGJJF",
    displayName: null,
    verificationMethod: "channel_challenge",
    verifiedAt: "2026-09-17T00:00:00Z",
  };
}

function renderForm() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ChannelIdentitySelfLinkSettings />
    </QueryClientProvider>,
  );
}

const optionLabels = () =>
  Array.from((screen.getByLabelText("Connection") as HTMLSelectElement).options)
    .slice(1)
    .map(({ textContent }) => textContent);
const createButton = () =>
  screen.getByRole("button", { name: "Create link code" }) as HTMLButtonElement;

it("offers only bots of workspaces you have not linked", async () => {
  boundary.connections = [bot("a1", "dai", "T1"), bot("a2", "oai", "T1"), bot("b1", "ext", "T2")];
  boundary.identities = [linked("T1")];
  renderForm();
  expect(await screen.findByText("Slack · dai, oai · VeXeRe · slack:T1")).toBeTruthy();
  await waitFor(() => expect(optionLabels()).toEqual(["Slack · ext"]));
});

it("tells you everything is linked instead of that nothing is available", async () => {
  boundary.connections = [bot("a1", "dai", "T1"), bot("a2", "oai", "T1")];
  boundary.identities = [linked("T1")];
  renderForm();
  expect(
    await screen.findByText(
      "Every Slack workspace and Telegram account available to you is already linked.",
    ),
  ).toBeTruthy();
  expect(createButton().disabled).toBe(true);
});

it("answers a link request for an already linked workspace with a notice, not an error", async () => {
  boundary.requestedConnectionId = "a2";
  boundary.connections = [bot("a1", "dai", "T1"), bot("a2", "oai", "T1")];
  boundary.identities = [linked("T1")];
  renderForm();
  expect(await screen.findByText("You are already linked here")).toBeTruthy();
  expect(screen.queryByText("The requested Connection is unavailable")).toBeNull();
  expect(createButton().disabled).toBe(true);
});

it("drops the code and the choice once the link lands", async () => {
  boundary.connections = [bot("b1", "ext", "T2")];
  boundary.post.mockResolvedValue({
    command: "/link ABCDE-FGHJK",
    expiresAt: "2026-09-17T01:00:00Z",
  });
  renderForm();
  await waitFor(() => expect(optionLabels()).toEqual(["Slack · ext"]));
  fireEvent.change(screen.getByLabelText("Connection"), { target: { value: "b1" } });
  fireEvent.click(createButton());
  expect(await screen.findByText("/link ABCDE-FGHJK")).toBeTruthy();

  boundary.identities = [linked("T2")];
  await userEvent.click(screen.getByRole("button", { name: "Refresh identities" }));
  expect(await screen.findByText("Slack · ext · Other · slack:T2")).toBeTruthy();
  await waitFor(() => expect(screen.queryByText("/link ABCDE-FGHJK")).toBeNull());
  expect((screen.getByLabelText("Connection") as HTMLSelectElement).value).toBe("");
  expect(createButton().disabled).toBe(true);
});
