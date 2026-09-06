// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelActivity, initialChannelActivityState } from "./channel-activity";

const fixture = vi.hoisted(() => ({ get: vi.fn(), push: vi.fn() }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: fixture.push }) }));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("@/styles/settings", () => ({ settingsStyles: {} }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("../account-provider", () => ({
  useHubAccount: () => ({
    enabled: true,
    origin: "https://hub.test",
    signedIn: { organization: { id: "org" }, account: { id: "owner" } },
    api: () => ({ get: fixture.get }),
  }),
}));
vi.mock("@/screens/settings/settings-section", () => ({
  SettingsSection: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));
vi.mock("@/components/ui/alert", () => ({
  Alert: ({
    title,
    description,
    children,
  }: {
    title: string;
    description?: string;
    children?: ReactNode;
  }) => (
    <div role="alert">
      <strong>{title}</strong>
      <p>{description}</p>
      {children}
    </div>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress(): void;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/select-field", () => ({
  SelectField: function Select({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: { id: string; value: string; label: string }[];
    onChange(value: string): void;
  }) {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value),
      [onChange],
    );
    return (
      <select aria-label={label} value={value} onChange={change}>
        {options.map((option) => (
          <option key={option.id} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  },
}));
const accounts = [
  { channel: "slack", accountId: "support", connectionId: "actual-connection", routes: [{}, {}] },
];
const connections = [
  {
    id: "actual-connection",
    provider: "slack",
    name: "Support",
    providerApplicationId: null,
    externalName: null,
    status: "connected",
    canLinkIdentity: true,
    consumers: [],
  },
];
const event = {
  id: "event",
  createdAt: "2026-09-05T00:00:00Z",
  channel: "slack",
  accountId: "support",
  routePosition: 0,
  conversationId: "C1",
  threadId: null,
  providerSenderId: "sender",
  outcome: "ignored",
  outcomeDetail: "sender may not trigger this route",
  limitDecision: "not_evaluated",
};
let client: QueryClient;
function Harness() {
  const [state, setState] = React.useState(initialChannelActivityState);
  return (
    <ChannelActivity
      accounts={accounts}
      connections={connections}
      state={state}
      onChange={setState}
    />
  );
}
function view() {
  return (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fixture.get.mockResolvedValue({ activity: [event], nextCursor: null });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});

async function openDetails() {
  fireEvent.click(await screen.findByRole("button", { name: "Details" }));
}

describe("Channel activity pages and detail recovery", () => {
  it.each([
    { reason: "sender may not trigger this route: unknown policy", identity: false, access: false },
    {
      reason: "sender identity is not linked to a Hub Member on this Connection",
      identity: true,
      access: false,
    },
    {
      reason: "linked Hub Member does not have access to this conversation",
      identity: false,
      access: true,
    },
    { reason: "sender may not trigger this route", identity: true, access: true },
  ])(
    "keeps recovery out of summary rows and preserves exact $reason",
    async ({ reason, identity, access }) => {
      fixture.get.mockResolvedValue({
        activity: [{ ...event, outcomeDetail: reason }],
        nextCursor: null,
      });
      render(view());
      await screen.findByText("Route 1 · Ignored");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("button", { name: /Link my identity/ })).toBeNull();
      await openDetails();
      expect(screen.getByText("Conversation")).toBeTruthy();
      expect(screen.getByText(/Route positions describe/)).toBeTruthy();
      expect(!!screen.queryByRole("button", { name: /Link my identity/ })).toBe(identity);
      expect(!!screen.queryByRole("button", { name: "Manage access" })).toBe(access);
      if (identity) {
        fireEvent.click(screen.getByRole("button", { name: /Link my identity/ }));
        expect(fixture.push).toHaveBeenCalledWith({
          pathname: "/settings/hub/[hubSection]",
          params: { hubSection: "account", channelConnectionId: "actual-connection" },
        });
      }
    },
  );

  it("does not link a historical removed account through an unrelated Connection", async () => {
    fixture.get.mockResolvedValue({
      activity: [{ ...event, accountId: "retired" }],
      nextCursor: null,
    });
    render(view());
    await openDetails();
    expect(screen.getByText("Slack · retired")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Link my identity/ })).toBeNull();
    expect(screen.getByText(/no current Connection available/)).toBeTruthy();
  });

  it("replaces bounded pages, keeps the last page on failure, and resets cursor/detail with filters", async () => {
    let olderFails = true;
    const first = Array.from({ length: 25 }, (_, index) => ({
      ...event,
      id: `first-${index}`,
      accountId: `first-${index}`,
    }));
    fixture.get.mockImplementation(async (resource: string) => {
      const query = new URL(`https://hub.test/${resource}`).searchParams;
      if (query.get("cursor")) {
        if (olderFails) throw new Error("offline");
        return { activity: [{ ...event, id: "older", accountId: "older" }], nextCursor: null };
      }
      return { activity: first, nextCursor: "opaque+cursor" };
    });
    render(view());
    await screen.findByText("Slack · first-0");
    fireEvent.click(screen.getByRole("button", { name: "Older" }));
    await screen.findByText("Channel activity is unavailable");
    expect(screen.getAllByRole("button", { name: "Details" })).toHaveLength(25);
    expect(screen.getByText(/Page 1/)).toBeTruthy();
    olderFails = false;
    fireEvent.click(screen.getByRole("button", { name: "Refresh activity" }));
    await screen.findByText("Slack · older");
    expect(screen.queryByText("Slack · first-0")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Details" })).toHaveLength(1);
    await openDetails();
    fireEvent.change(screen.getByLabelText("Channel account"), {
      target: { value: "slack:support" },
    });
    expect(screen.queryByRole("button", { name: "Back to activity" })).toBeNull();
    await waitFor(() =>
      expect(fixture.get).toHaveBeenLastCalledWith(
        "channel-activity?limit=25&channel=slack&accountId=support",
        expect.anything(),
      ),
    );
    fireEvent.change(screen.getByLabelText("Route"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Outcome"), { target: { value: "ignored" } });
    await waitFor(() =>
      expect(fixture.get).toHaveBeenLastCalledWith(
        "channel-activity?limit=25&channel=slack&accountId=support&routePosition=1&outcome=ignored",
        expect.anything(),
      ),
    );
    expect((screen.getByRole("button", { name: "Newer" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      client
        .getQueryCache()
        .getAll()
        .every((query) => query.queryKey.includes("owner")),
    ).toBe(true);
  });

  it("never shows prior account results under a new filter while it loads or fails", async () => {
    fixture.get.mockImplementation(async (resource: string) => {
      if (resource.includes("accountId=")) throw new Error("failed scoped fetch");
      return { activity: [event], nextCursor: null };
    });
    render(view());
    await screen.findByText("Route 1 · Ignored");
    fireEvent.change(screen.getByLabelText("Channel account"), {
      target: { value: "slack:support" },
    });
    await screen.findByText("Channel activity is unavailable");
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
    expect(screen.queryByText(/No events match/)).toBeNull();
  });

  it("treats an unavailable old-Hub endpoint as recoverable failure, without fanout or fake empty success", async () => {
    fixture.get.mockRejectedValue(new Error("404 not found"));
    render(view());
    await screen.findByText("Channel activity is unavailable");
    expect(screen.getByText(/update the Hub/)).toBeTruthy();
    expect(screen.queryByText(/No events match/)).toBeNull();
    expect(fixture.get).toHaveBeenCalledTimes(1);
    expect(fixture.get).toHaveBeenCalledWith("channel-activity?limit=25", expect.anything());
    fixture.get.mockResolvedValue({ activity: [], nextCursor: null });
    fireEvent.click(screen.getByRole("button", { name: "Refresh activity" }));
    await screen.findByText(/No events match/);
  });
});
