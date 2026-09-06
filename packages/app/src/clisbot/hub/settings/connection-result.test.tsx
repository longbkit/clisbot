// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HubConnectionResultNotice } from "./connection-result";

const { invalidateQueries, setParams, params } = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  setParams: vi.fn(),
  params: { app: "slack", result: "slack_connected" },
}));
const queryClient = new QueryClient();
queryClient.invalidateQueries = invalidateQueries;
const router = { setParams };
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => params,
  useRouter: () => router,
}));
vi.mock("../account-provider", () => ({
  useHubAccount: () => ({
    enabled: true,
    origin: "https://hub.example.test",
    signedIn: { organization: { id: "org" }, account: { id: "member" } },
  }),
}));
vi.mock("@/components/ui/alert", () => ({
  Alert: ({
    title,
    description,
    children,
  }: {
    title: string;
    description: string;
    children?: ReactNode;
  }) => (
    <div role="alert">
      <span>{title}</span>
      <span>{description}</span>
      {children}
    </div>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    onPress,
    children,
    loading,
  }: {
    onPress(): void;
    children: ReactNode;
    loading?: boolean;
  }) => (
    <button type="button" disabled={loading} onClick={onPress}>
      {children}
    </button>
  ),
}));
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.resetAllMocks();
  params.app = "slack";
  params.result = "slack_connected";
});

describe("provider callback notice", () => {
  it("refreshes authenticated inventories and offers retry when the callback returns during a network failure", async () => {
    invalidateQueries.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    render(
      <QueryClientProvider client={queryClient}>
        <HubConnectionResultNotice />
      </QueryClientProvider>,
    );
    await screen.findByText("Connection status could not refresh");
    expect(screen.getByText("Slack setup completed").textContent).toBe("Slack setup completed");
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    let finishRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    invalidateQueries.mockReturnValueOnce(pendingRefresh).mockReturnValueOnce(pendingRefresh);
    fireEvent.click(screen.getByText("Retry refresh"));
    await screen.findByText("Refreshing Connection status");
    expect(screen.getByText("Retry refresh").closest("button")?.disabled).toBe(true);
    await act(async () => {
      finishRefresh();
      await pendingRefresh;
    });
    await waitFor(() => expect(screen.queryByText("Refreshing Connection status")).toBe(null));
    expect(screen.queryByText("Connection status could not refresh")).toBe(null);
    expect(invalidateQueries).toHaveBeenCalledTimes(4);
    expect(invalidateQueries).toHaveBeenCalledWith(
      {
        queryKey: [
          "clisbot",
          "hub",
          "https://hub.example.test",
          "org",
          "account",
          "member",
          "connections",
        ],
      },
      { throwOnError: true },
    );
    fireEvent.click(screen.getByText("Dismiss"));
    expect(setParams).toHaveBeenCalledWith({ app: undefined, result: undefined });
  });

  it("ignores unknown callback text without rendering or refreshing", () => {
    params.result = "untrusted message";
    render(
      <QueryClientProvider client={queryClient}>
        <HubConnectionResultNotice />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("alert")).toBe(null);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
