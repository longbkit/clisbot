import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import NotFoundScreen from "./not-found-screen";

const router = vi.hoisted(() => ({ canGoBack: vi.fn(), back: vi.fn(), replace: vi.fn() }));
vi.mock("expo-router", () => ({ useRouter: () => router }));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (create: (theme: unknown) => unknown) =>
      create({ spacing: { 4: 16 }, colors: { foregroundMuted: "gray" }, fontSize: { base: 15 } }),
  },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/page-layout", () => ({
  PageLayout: ({
    title,
    onBack,
    children,
  }: React.PropsWithChildren<{ title: string; onBack: () => void }>) => (
    <main>
      <h1>{title}</h1>
      <button type="button" onClick={onBack}>
        Back
      </button>
      {children}
    </main>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ onPress, children }: React.PropsWithChildren<{ onPress: () => void }>) => (
    <button type="button" onClick={onPress}>
      {children}
    </button>
  ),
}));
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  const dom = new JSDOM("<div id='root'></div>", {
    url: "https://app.example.test/missing?code=private",
  });
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  root = createRoot(document.getElementById("root")!);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
test.each([true, false])(
  "unknown-link recovery works with history=%s without exposing the URL or diagnostic sitemap",
  (history) => {
    router.canGoBack.mockReturnValue(history);
    act(() => root.render(<NotFoundScreen />));
    expect(document.body.textContent).not.toMatch(/private|missing|sitemap/i);
    act(() => document.querySelectorAll("button")[0]!.click());
    expect(router.back).toHaveBeenCalledTimes(history ? 1 : 0);
    expect(router.replace).toHaveBeenCalledTimes(history ? 0 : 1);
    act(() => document.querySelectorAll("button")[1]!.click());
    expect(router.replace).toHaveBeenLastCalledWith("/open-project");
  },
);
