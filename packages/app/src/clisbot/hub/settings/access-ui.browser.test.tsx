import React, { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { ConfirmationProvider } from "@/components/confirmation-provider";
import { SelectField } from "@/components/ui/select-field";
import { confirmDialog } from "@/utils/confirm-dialog";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "@/i18n/resources/en";

// Exercise actual web controls and modal with production theme tokens. The global
// browser configuration only stubs native packages/icons; no picker/dialog mock.
beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
});
vi.mock("react-native-unistyles", async () => {
  const { lightTheme } = await import("@/styles/theme");
  const { StyleSheet } = await import("react-native");
  return {
    StyleSheet: {
      ...StyleSheet,
      create: <T,>(styles: T | ((theme: typeof lightTheme) => T)): T =>
        typeof styles === "function"
          ? (styles as (theme: typeof lightTheme) => T)(lightTheme)
          : styles,
    },
    withUnistyles: <T,>(component: T): T => component,
    useUnistyles: () => ({
      theme: lightTheme,
      rt: { breakpoint: window.innerWidth < 500 ? "xs" : "lg" },
    }),
  };
});
const options = [
  ...Array.from({ length: 70 }, (_, index) => ({
    id: `team-${index}`,
    value: `team-${index}`,
    label: index === 0 ? "AI Team" : `Team ${index}`,
    group: "Teams",
  })),
  {
    id: "member",
    value: "member",
    label: "Long Luong 02",
    description: "longbkit@gmail.com",
    group: "Members",
  },
];
function Harness({ scopeKey = "access" }: { scopeKey?: string }) {
  const [value, setValue] = useState<string | null>("team-69");
  const [result, setResult] = useState("Pending");
  return (
    <ConfirmationProvider webBackend scopeKey={scopeKey}>
      <SelectField
        label="Team or Member"
        value={value}
        selectedDisplay={options.find((option) => option.id === value) ?? null}
        options={options}
        onChange={setValue}
        placeholder="Choose a Team or Member"
        emptyText="No matches"
        searchable
        maxOptionsPerGroup={50}
        searchPlaceholder="Search Teams, Members, or email"
      />
      <button
        onClick={async () =>
          setResult(
            String(
              await confirmDialog({
                title: "Grant this access?",
                message:
                  "AI Team → Longluongbrain\nAccess level: Office worker\nAgent configurations: 2",
                confirmLabel: "Grant access",
              }),
            ),
          )
        }
      >
        Open confirmation
      </button>
      <div data-testid="result">{result}</div>
    </ConfirmationProvider>
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("shows grouped search, retains selected values beyond cap, and supports email keyboard selection", async () => {
  vi.stubGlobal("React", React);
  await page.viewport(1200, 1000);
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: /Team 69/ }));
  await screen.findByPlaceholderText("Search Teams, Members, or email");
  await page.screenshot({ path: "/tmp/access-picker-desktop.png" });
  expect(screen.getByText("Teams")).toBeTruthy();
  expect(screen.getByText("Members")).toBeTruthy();
  expect(screen.getByText(/Showing 51 of 71/)).toBeTruthy();
  expect(screen.getAllByText("Team 69").length).toBe(2);
  await userEvent.fill(
    screen.getByPlaceholderText("Search Teams, Members, or email"),
    "no-such-member",
  );
  await screen.findByText("No options match your search.");
  await userEvent.fill(screen.getByPlaceholderText("Search Teams, Members, or email"), "");
  expect(screen.getByText("Teams")).toBeTruthy();
  expect(screen.getByText("Members")).toBeTruthy();
  await userEvent.fill(
    screen.getByPlaceholderText("Search Teams, Members, or email"),
    "longbkit@gmail.com",
  );
  await userEvent.keyboard("{ArrowDown}{Enter}");
  await waitFor(() =>
    expect(screen.queryByPlaceholderText("Search Teams, Members, or email")).toBeNull(),
  );
  expect(screen.getByRole("button", { name: /Long Luong 02/ })).toBeTruthy();
});
it.each(["Escape", "Cancel", "Dismiss"])(
  "uses app confirmation and cancels with %s",
  async (action) => {
    vi.stubGlobal("React", React);
    const browserConfirm = vi.spyOn(window, "confirm").mockImplementation(() => {
      throw new Error("Unexpected browser dialog");
    });
    render(<Harness />);
    await userEvent.click(screen.getByText("Open confirmation"));
    await screen.findByText("Grant this access?");
    await page.screenshot({ path: "/tmp/access-confirmation-desktop.png" });
    if (action === "Escape") await userEvent.keyboard("{Escape}");
    else if (action === "Dismiss")
      await userEvent.click(screen.getByTestId("app-confirmation"), { position: { x: 5, y: 5 } });
    else await userEvent.click(screen.getByRole("button", { name: action }));
    await waitFor(() => expect(screen.getByTestId("result").textContent).toBe("false"));
    expect(browserConfirm).not.toHaveBeenCalled();
  },
);

it("authorizes only after clicking the app confirm action", async () => {
  vi.stubGlobal("React", React);
  render(<Harness />);
  await userEvent.click(screen.getByText("Open confirmation"));
  await screen.findByText("Grant this access?");
  expect(screen.getByTestId("result").textContent).toBe("Pending");
  await userEvent.click(screen.getByRole("button", { name: "Grant access" }));
  await waitFor(() => expect(screen.getByTestId("result").textContent).toBe("true"));
});
it("cancels an open confirmation when the route scope changes", async () => {
  vi.stubGlobal("React", React);
  const view = render(<Harness />);
  await userEvent.click(screen.getByText("Open confirmation"));
  await screen.findByText("Grant this access?");
  view.rerender(<Harness scopeKey="teams" />);
  await waitFor(() => expect(screen.getByTestId("result").textContent).toBe("false"));
});
