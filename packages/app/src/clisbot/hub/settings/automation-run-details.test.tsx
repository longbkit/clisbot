// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationActivity, AutomationRunDetails } from "./automation-run-details";

const fixture = vi.hoisted(() => ({ get: vi.fn(), accountId: "owner", close: vi.fn() }));
vi.mock("../account-provider", () => ({
  useHubAccount: () => ({
    origin: "https://hub.example.test",
    signedIn: {
      account: { id: fixture.accountId },
      organization: { id: "organization" },
      capabilities: { manageResources: true },
    },
    api: () => ({ get: fixture.get }),
  }),
}));
vi.mock("@/styles/settings", () => ({ settingsStyles: {} }));
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
      {title}
      {description}
      {children}
    </div>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onPress }: { children: ReactNode; onPress(): void }) => (
    <button type="button" onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/screens/settings/settings-section", () => ({
  SettingsSection: ({
    title,
    trailing,
    children,
  }: {
    title: string;
    trailing?: ReactNode;
    children: ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      {trailing}
      {children}
    </section>
  ),
}));

const run = {
  id: "run/1",
  outcome: "accepted" as const,
  status: "failed" as const,
  revisionId: "revision",
  provider: "manual" as const,
  source: "manual.run",
  createdAt: "2026-09-05T00:00:00Z",
  completedAt: "2026-09-05T00:01:00Z",
  error: "Execution failed",
};
const details = {
  ...run,
  steps: [
    {
      id: "step-1",
      name: "Reply",
      status: "failed",
      startedAt: run.createdAt,
      completedAt: run.completedAt,
      error: "Output limit reached",
      outputs: { "telegram.reply": 2 },
    },
  ],
};
const clients: QueryClient[] = [];
function setup(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children: content }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{content}</QueryClientProvider>
  );
  return render(children, { wrapper });
}
function ActivityHarness() {
  const activity = useQuery({ queryKey: ["activity"], queryFn: async () => ({ activity: [run] }) });
  return <AutomationActivity automationId="automation/1" activity={activity} />;
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.resetAllMocks();
  fixture.accountId = "owner";
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

describe("Automation Activity run details", () => {
  it("opens a run, recovers a failed read, and shows step outcomes and output counts", async () => {
    fixture.get.mockRejectedValueOnce(new Error("Host unavailable"));
    setup(<ActivityHarness />);
    fireEvent.click(await screen.findByRole("button", { name: "View details" }));
    expect(await screen.findByText(/Host unavailable/)).toBeTruthy();
    fixture.get.mockResolvedValueOnce(details);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Reply · failed")).toBeTruthy();
    expect(screen.getByText("Output limit reached")).toBeTruthy();
    expect(screen.getByText("telegram reply: 2")).toBeTruthy();
    expect(fixture.get).toHaveBeenLastCalledWith(
      "automations/automation%2F1/runs/run%2F1",
      expect.anything(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to Activity" }));
    expect(screen.getByRole("button", { name: "View details" })).toBeTruthy();
  });
  it("does not display a previous account's run while the new account loads", async () => {
    fixture.get.mockResolvedValueOnce(details);
    const ui = setup(
      <AutomationRunDetails automationId="automation" runId="run" close={fixture.close} />,
    );
    await screen.findByText("Reply · failed");
    let resolve!: (value: unknown) => void;
    fixture.get.mockImplementationOnce(
      () =>
        new Promise((value) => {
          resolve = value;
        }),
    );
    fixture.accountId = "other-owner";
    ui.rerender(
      <AutomationRunDetails automationId="automation" runId="run" close={fixture.close} />,
    );
    expect(screen.queryByText("Reply · failed")).toBeNull();
    expect(screen.getByText("Loading run details...")).toBeTruthy();
    await act(async () =>
      resolve({ ...details, status: "rejected", error: "Trigger rejected", steps: [] }),
    );
    expect(await screen.findByText("No steps were started for this run.")).toBeTruthy();
    expect(screen.queryByText("telegram reply: 2")).toBeNull();
  });
  it("refreshes completed run details explicitly without creating another run", async () => {
    fixture.get.mockResolvedValue(details);
    setup(<AutomationRunDetails automationId="automation" runId="run" close={fixture.close} />);
    await screen.findByText("Reply · failed");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(fixture.get).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Back to Activity" }));
    expect(fixture.close).toHaveBeenCalledOnce();
  });
});
