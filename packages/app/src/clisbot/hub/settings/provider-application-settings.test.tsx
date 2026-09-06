// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderApplicationSettings } from "./provider-application-settings";

const { post, refetch, invalidateQueries } = vi.hoisted(() => ({
  post: vi.fn(),
  refetch: vi.fn(),
  invalidateQueries: vi.fn(),
}));
const queryClient = { invalidateQueries };
const overview = {
  applications: { github: [], slack: [], discord: [], linear: [] },
  providers: {
    github: { status: "notConfigured" },
    slack: { status: "notConfigured" },
    discord: { status: "notConfigured" },
    linear: { status: "notConfigured" },
  },
  setupGuides: [],
};
const applications: {
  data: typeof overview | undefined;
  isPending: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: typeof refetch;
} = {
  data: overview,
  isPending: false,
  isFetching: false,
  error: null,
  refetch,
};
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => queryClient }));
vi.mock("@/data/query", () => ({ useFetchQuery: () => applications }));
vi.mock("../account-provider", () => ({
  useHubAccount: () => ({
    enabled: true,
    origin: "https://hub.example.test",
    state: { status: "active", isInstanceOperator: true },
    signedIn: { organization: { id: "org" }, account: { id: "member" } },
    api: () => ({ post }),
  }),
}));
// The form itself has separate behavioral tests. Supply a valid draft so this test exercises
// the parent flow after Hub has accepted the credentials and the sheet has closed.
vi.mock("../provider-application-form", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../provider-application-form")>();
  return {
    ...actual,
    openHubProviderApplicationForm: () => {
      const form = actual.openHubProviderApplicationForm();
      for (const field of ["appId", "appSlug", "clientId", "clientSecret", "privateKey"] as const) {
        form.setField(field, "valid-draft");
      }
      return form;
    },
  };
});
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("@/styles/settings", () => ({ settingsStyles: {} }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("@/utils/copy-to-clipboard", () => ({ copyToClipboard: vi.fn() }));
vi.mock("expo-linking", () => ({ openURL: vi.fn() }));
vi.mock("@/components/ui/external-link", () => ({ ExternalLink: () => null }));
vi.mock("@/components/ui/form-field", () => ({ Field: () => null, FormTextInput: () => null }));
vi.mock("@/components/ui/select-field", () => ({ SelectField: () => null }));
vi.mock("@/components/ui/status-badge", () => ({ StatusBadge: () => null }));
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <div role="dialog">
      {children}
      {footer}
    </div>
  ),
}));
vi.mock("@/screens/settings/settings-section", () => ({
  SettingsSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));
vi.mock("@/components/ui/alert", () => ({
  Alert: ({ title }: { title: string }) => <div role="alert">{title}</div>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    onPress,
    children,
    disabled,
  }: {
    onPress(): void;
    children: ReactNode;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
beforeEach(() => {
  vi.stubGlobal("React", React);
  applications.data = overview;
  applications.isPending = false;
  applications.error = null;
  post.mockResolvedValue({ status: "verified" });
  refetch.mockImplementation(async (options?: { throwOnError?: boolean }) => {
    if (options?.throwOnError) throw new Error("offline");
    return { isError: true, error: new Error("offline") };
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("Provider Application save recovery", () => {
  it("keeps a post-save refresh failure visible after closing the credential sheet", async () => {
    render(<ProviderApplicationSettings />);
    fireEvent.click(screen.getByText("Add provider application"));
    fireEvent.click(screen.getByText("Verify and save"));
    await screen.findByText("Provider details could not refresh. Use Refresh to try again.");
    expect(screen.queryByRole("dialog")).toBe(null);
    expect(refetch).toHaveBeenCalledWith({ throwOnError: true });
    refetch.mockResolvedValueOnce({ isError: false });
    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() =>
      expect(
        screen.queryByText("Provider details could not refresh. Use Refresh to try again."),
      ).toBe(null),
    );
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("waits for inventory before showing an empty state or enabling a new Application", () => {
    applications.data = undefined;
    applications.isPending = true;
    const { rerender } = render(<ProviderApplicationSettings />);
    expect(screen.queryByText("No Provider Applications configured")).toBe(null);
    expect(screen.getByText("Add provider application").closest("button")?.disabled).toBe(true);
    applications.isPending = false;
    applications.error = new Error("inventory unavailable");
    rerender(<ProviderApplicationSettings />);
    expect(screen.getByText("inventory unavailable").textContent).toBe("inventory unavailable");
    expect(screen.queryByText("No Provider Applications configured")).toBe(null);
    applications.data = overview;
    rerender(<ProviderApplicationSettings />);
    expect(screen.getByText("No Provider Applications configured").textContent).toBe(
      "No Provider Applications configured",
    );
    expect(screen.getByText("Add provider application").closest("button")?.disabled).toBe(false);
  });
});
