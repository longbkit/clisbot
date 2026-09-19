import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { ChannelIdentitySelfLinkSettings } from "./channel-identity-self-link";

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
    identityRealmScope: "tenant",
    canLinkIdentity: true,
    consumers: [{ resourceKind: "channel_account", resourceId: `slack/${account}`, name: account }],
  };
}

/** A Channel-owned bot: every bot shares the realm (`channel`), or each is its own (`bot`). */
function chatBot(
  provider: string,
  id: string,
  account: string,
  scope: "channel" | "bot",
  externalName: string | null = null,
) {
  return {
    ...bot(id, account, "unused"),
    provider,
    name: account,
    externalName,
    identityRealm: scope === "channel" ? provider : `${provider}:bot:${id}`,
    identityRealmScope: scope,
    consumers: [
      { resourceKind: "channel_account", resourceId: `${provider}/${account}`, name: account },
    ],
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

const LIVE_CODE = { command: "/link ABCDE-FGHJK", expiresAt: "2099-01-01T00:00:00Z" };

function renderForm() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ChannelIdentitySelfLinkSettings />
    </QueryClientProvider>,
  );
}

const picker = () => screen.getByLabelText("Where you chat") as HTMLSelectElement;
const optionLabels = () =>
  Array.from(picker().options)
    .slice(1)
    .map(({ textContent }) => textContent);
const createButton = () =>
  screen.getByRole("button", { name: "Create link code" }) as HTMLButtonElement;

it("offers each unlinked Slack workspace once, not each of its bots", async () => {
  boundary.connections = [
    bot("a1", "dai", "T1"),
    bot("a2", "oai", "T1"),
    bot("b1", "ext", "T2"),
    bot("b2", "ops", "T2"),
    bot("c1", "qa", "T3"),
  ];
  boundary.identities = [linked("T1")];
  renderForm();
  expect(await screen.findByText("Slack · VeXeRe · works with dai, oai")).toBeTruthy();
  await waitFor(() => expect(optionLabels()).toEqual(["Slack · Other", "Slack · Other"]));
});

it("names each realm by its scope on every Channel", async () => {
  boundary.connections = [
    chatBot("telegram", "t1", "support", "channel", "acme_support_bot"),
    chatBot("discord", "d1", "helper", "channel"),
    chatBot("feishu", "f1", "feishu-a", "bot"),
    chatBot("feishu", "f2", "feishu-b", "bot"),
  ];
  renderForm();
  await waitFor(() =>
    expect(optionLabels()).toEqual([
      "Telegram",
      "Discord",
      "Feishu · feishu-a",
      "Feishu · feishu-b",
    ]),
  );
});

it("hides the form and says so when everything is linked", async () => {
  boundary.connections = [bot("a1", "dai", "T1"), bot("a2", "oai", "T1")];
  boundary.identities = [linked("T1")];
  renderForm();
  expect(
    await screen.findByText("You are linked everywhere this organization's bots run."),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Create link code" })).toBeNull();
});

it("answers a link request for an already linked workspace with a notice, not an error", async () => {
  boundary.requestedConnectionId = "a2";
  boundary.connections = [bot("a1", "dai", "T1"), bot("a2", "oai", "T1"), bot("b1", "ext", "T2")];
  boundary.identities = [linked("T1")];
  renderForm();
  expect(await screen.findByText("You are already linked here")).toBeTruthy();
  expect(screen.queryByText("That bot is no longer available")).toBeNull();
});

it("selects the realm of a bot you came from even when you cannot issue through that bot", async () => {
  boundary.requestedConnectionId = "b2";
  boundary.connections = [
    bot("a1", "dai", "T1"),
    bot("b1", "ext", "T2"),
    { ...bot("b2", "ops", "T2"), canLinkIdentity: false },
  ];
  boundary.post.mockResolvedValue(LIVE_CODE);
  renderForm();
  await waitFor(() => expect(picker().value).toBe("slack:T2"));
  expect(screen.queryByText("That bot is no longer available")).toBeNull();
  fireEvent.click(createButton());
  expect(await screen.findByText(/mention any bot of this workspace \(ext, ops\)/)).toBeTruthy();
  expect(boundary.post).toHaveBeenCalledExactlyOnceWith(
    "channel-identities/challenges",
    { connectionId: "b1" },
    expect.anything(),
  );
});

it("preselects the only place left and reports what the landed link covers", async () => {
  boundary.connections = [bot("b1", "ext", "T2"), bot("b2", "ops", "T2")];
  boundary.post.mockResolvedValue(LIVE_CODE);
  renderForm();
  await waitFor(() => expect(picker().value).toBe("slack:T2"));
  fireEvent.click(createButton());
  expect(await screen.findByText("/link ABCDE-FGHJK")).toBeTruthy();
  expect(screen.getByText(/Waiting for your message/)).toBeTruthy();

  boundary.identities = [linked("T2")];
  await userEvent.click(screen.getByRole("button", { name: "Refresh identities" }));
  expect(await screen.findByText("Linked: Slack · Other")).toBeTruthy();
  expect(screen.getByText(/Every bot here now recognizes you: ext, ops\./)).toBeTruthy();
  expect(screen.queryByText("/link ABCDE-FGHJK")).toBeNull();
  expect(screen.queryByRole("button", { name: "Create link code" })).toBeNull();
});

it("names Telegram bots by @username and lists every bot the code works with", async () => {
  boundary.connections = [
    chatBot("telegram", "t1", "support", "channel", "acme_support_bot"),
    { ...chatBot("telegram", "t2", "sales", "channel"), canLinkIdentity: false },
  ];
  boundary.post.mockResolvedValue(LIVE_CODE);
  renderForm();
  await waitFor(() => expect(picker().value).toBe("telegram"));
  fireEvent.click(createButton());
  expect(
    await screen.findByText(/to any one of these bots: @acme_support_bot, sales\./),
  ).toBeTruthy();
  expect(boundary.post).toHaveBeenCalledExactlyOnceWith(
    "channel-identities/challenges",
    { connectionId: "t1" },
    expect.anything(),
  );
});

it("tells a bot-scoped link to cover only its bot", async () => {
  boundary.connections = [chatBot("feishu", "f1", "feishu-a", "bot")];
  boundary.post.mockResolvedValue(LIVE_CODE);
  renderForm();
  await waitFor(() => expect(picker().value).toBe("feishu:bot:f1"));
  fireEvent.click(createButton());
  expect(await screen.findByText(/to the bot feishu-a\./)).toBeTruthy();
});

it("marks a code expired instead of showing it as usable", async () => {
  boundary.connections = [bot("b1", "ext", "T2")];
  boundary.post.mockResolvedValue({ ...LIVE_CODE, expiresAt: "2020-01-01T00:00:00Z" });
  renderForm();
  await waitFor(() => expect(picker().value).toBe("slack:T2"));
  fireEvent.click(createButton());
  expect(await screen.findByText("This link code expired")).toBeTruthy();
  expect(screen.queryByText("/link ABCDE-FGHJK")).toBeNull();
});
