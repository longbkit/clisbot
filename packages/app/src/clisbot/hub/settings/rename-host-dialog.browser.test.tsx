import React, { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "@/i18n/resources/en";
import { RenameHostDialog } from "./rename-host-dialog";
import { HubApiError } from "../api-client";

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("cancels without saving and retries a conflicting Host name in the app dialog", async () => {
  vi.stubGlobal("React", React);
  await page.viewport(1200, 900);
  const save = vi
    .fn<(name: string) => Promise<void>>()
    .mockRejectedValueOnce(new HubApiError(409, "daemon_slug_conflict", "conflict"))
    .mockResolvedValueOnce(undefined);
  function Harness() {
    const [saved, setSaved] = useState("sandbox");
    const [open, setOpen] = useState(true);
    return (
      <>
        <div data-testid="saved-name">{saved}</div>
        <button onClick={() => setOpen(true)}>Rename</button>
        {open ? (
          <RenameHostDialog
            name={saved}
            onClose={() => setOpen(false)}
            onSave={async (value) => {
              await save(value);
              setSaved(value.toLowerCase().replaceAll(" ", "-"));
            }}
          />
        ) : null}
      </>
    );
  }
  render(<Harness />);
  expect(screen.getByTestId("rename-host-dialog-submit").getAttribute("aria-disabled")).toBe(
    "true",
  );
  await userEvent.fill(screen.getByTestId("rename-host-dialog-input"), "Unsaved change");
  await userEvent.click(screen.getByTestId("rename-host-dialog-cancel"));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByTestId("saved-name").textContent).toBe("sandbox");
  await userEvent.click(screen.getByText("Rename", { exact: true }));
  await userEvent.fill(screen.getByTestId("rename-host-dialog-input"), "  Existing Host  ");
  await userEvent.click(screen.getByTestId("rename-host-dialog-submit"));
  await screen.findByText("Another Host already uses that name. Choose a different name.");
  expect(save).toHaveBeenLastCalledWith("Existing Host");
  await page.screenshot({ path: "/tmp/rename-host-conflict-desktop.png" });
  await userEvent.fill(screen.getByTestId("rename-host-dialog-input"), "New Sandbox");
  await userEvent.click(screen.getByTestId("rename-host-dialog-submit"));
  await waitFor(() => expect(screen.queryByTestId("rename-host-dialog-input")).toBeNull());
  expect(save).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId("saved-name").textContent).toBe("new-sandbox");
});
