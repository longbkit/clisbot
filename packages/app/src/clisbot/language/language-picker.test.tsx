// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { LANGUAGE_OPTIONS } from "@/i18n/locales";
import { LanguageSettingsCard } from "./language-surfaces";
import { languageSelectionLabel, QUICK_LANGUAGE_ORDER } from "./language-labels";

const window = vi.hoisted(() => ({ width: 1024, compact: false }));
vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => window.compact,
}));
vi.mock("react-native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-native")>()),
  useWindowDimensions: () => ({ width: window.width, height: 800, scale: 1, fontScale: 1 }),
}));
vi.mock("@/hooks/use-settings", () => ({
  useAppSettings: () => ({ settings: { language: "system" }, updateSettings: vi.fn() }),
}));

beforeEach(() => i18n.changeLanguage("en"));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.width = 1024;
  window.compact = false;
});

function quick(locale: string): HTMLElement {
  return screen.getByTestId(`language-quick-${locale}`);
}

test("the dropdown names the language System resolved to, in the UI language", () => {
  expect(languageSelectionLabel("system", "en", "System")).toBe("System - English");
  expect(languageSelectionLabel("system", "vi", "Hệ thống")).toBe("Hệ thống - Tiếng Việt");
  expect(languageSelectionLabel("vi", "vi", "Hệ thống")).toBe("Tiếng Việt");
  expect(languageSelectionLabel("ja", "ja", "システム")).toBe("日本語");
});

test("the quick list offers every supported language exactly once", () => {
  const supported = LANGUAGE_OPTIONS.map((option) => option.value).filter((v) => v !== "system");
  expect([...QUICK_LANGUAGE_ORDER].sort()).toEqual([...supported].sort());
});

test("Settings shows the resolved language and switches with one tap", () => {
  const onChange = vi.fn();
  render(<LanguageSettingsCard language="system" onChange={onChange} />);
  expect(screen.getByText("System - English")).toBeTruthy();
  expect(screen.getByRole("radiogroup")).toBeTruthy();
  expect(quick("en").getAttribute("role")).toBe("radio");
  expect(quick("en").getAttribute("aria-checked")).toBe("true");
  expect(quick("vi").getAttribute("aria-checked")).toBe("false");
  expect(quick("vi").getAttribute("lang")).toBe("vi");

  fireEvent.click(quick("vi"));
  expect(onChange).toHaveBeenLastCalledWith("vi");

  // Tapping the language System resolved to pins it, as choosing it in the dropdown would.
  fireEvent.click(quick("en"));
  expect(onChange).toHaveBeenLastCalledWith("en");
});

test("a Vietnamese UI says Hệ thống and checks Tiếng Việt", async () => {
  await i18n.changeLanguage("vi");
  render(<LanguageSettingsCard language="system" onChange={vi.fn()} />);
  expect(screen.getByText("Hệ thống - Tiếng Việt")).toBeTruthy();
  expect(quick("vi").getAttribute("aria-checked")).toBe("true");
  expect(quick("en").getAttribute("aria-checked")).toBe("false");
});

test("a narrow window drops the System prefix from the dropdown", () => {
  window.width = 320;
  render(<LanguageSettingsCard language="system" onChange={vi.fn()} />);
  expect(screen.getByTestId("language-dropdown").textContent).toBe("English");
});

test("on a phone the Settings row names only the language", () => {
  window.compact = true;
  render(<LanguageSettingsCard language="system" onChange={vi.fn()} />);
  expect(screen.getByTestId("language-dropdown").textContent).toBe("English");
  expect(quick("en").getAttribute("aria-checked")).toBe("true");
});

test("tapping the language already chosen does nothing", () => {
  const onChange = vi.fn();
  render(<LanguageSettingsCard language="en" onChange={onChange} />);
  expect(screen.getByTestId("language-dropdown").textContent).toBe("English");
  fireEvent.click(quick("en"));
  expect(onChange).not.toHaveBeenCalled();
});
