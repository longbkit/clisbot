// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostConnectionMethods } from "./host-connection-methods";

const env = vi.hoisted(() => ({ isNative: false, isFdroid: false, isElectron: false }));
/** Any theme path reads as 0: the stylesheet only needs its keys here. */
const THEME = vi.hoisted(() => new Proxy({}, { get: () => new Proxy({}, { get: () => 0 }) }));
vi.mock("@/constants/platform", () => ({
  get isNative() {
    return env.isNative;
  },
}));
vi.mock("@/constants/build-profile", () => ({
  get isFdroidBuild() {
    return env.isFdroid;
  },
}));
vi.mock("@/desktop/host", () => ({ isElectronRuntime: () => env.isElectron }));
vi.mock("@/styles/settings", () => ({ settingsStyles: { card: "settingsCard" } }));
vi.mock("@/components/ui/external-link", () => ({
  ExternalLink: ({ href, label }: { href: string; label: string }) => <a href={href}>{label}</a>,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("lucide-react-native", () => ({
  QrCode: () => null,
  Link2: () => null,
  ClipboardPaste: () => null,
  Terminal: () => null,
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: (theme: unknown) => Record<string, unknown>) =>
      Object.fromEntries(Object.keys(factory(THEME)).map((key) => [key, key])),
  },
  withUnistyles: (component: unknown) => component,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children, style }: { children: React.ReactNode; style?: unknown }) => (
    <span data-style={JSON.stringify(style)}>{children}</span>
  ),
  Pressable: (props: {
    children: React.ReactNode;
    onPress(): void;
    testID: string;
    accessibilityLabel: string;
    style: (state: { hovered: boolean; pressed: boolean }) => unknown;
  }) => (
    <button
      type="button"
      data-testid={props.testID}
      aria-label={props.accessibilityLabel}
      data-style={JSON.stringify(props.style({ hovered: false, pressed: false }))}
      data-hover-style={JSON.stringify(props.style({ hovered: true, pressed: false }))}
      onClick={props.onPress}
    >
      {props.children}
    </button>
  ),
}));

const handlers = {
  onScanQr: vi.fn(),
  onPasteLink: vi.fn(),
  onDirectConnection: vi.fn(),
  onRemoteSsh: vi.fn(),
};
const TEST_IDS = {
  scanQr: "scan",
  pasteLink: "paste",
  direct: "direct",
  remoteSsh: "ssh",
};

function renderMethods() {
  return render(<HostConnectionMethods {...handlers} testIDs={TEST_IDS} />);
}
function rowOrder(): string[] {
  return screen.getAllByRole("button").map((button) => button.getAttribute("data-testid")!);
}

beforeEach(() => {
  env.isNative = false;
  env.isFdroid = false;
  env.isElectron = false;
  for (const handler of Object.values(handlers)) handler.mockReset();
});
afterEach(cleanup);

describe("HostConnectionMethods", () => {
  it("leads with pairing and the Pair device hint, then the manual ways under Other ways", () => {
    env.isNative = true;
    renderMethods();
    expect(screen.getByText("pairing.connectionMethods.intro")).toBeTruthy();
    expect(screen.getByText("pairing.connectionMethods.docs").getAttribute("href")).toBe(
      "https://clisbot.com/docs/connectivity",
    );
    expect(rowOrder()).toEqual(["scan", "paste", "direct"]);
    const text = document.body.textContent!;
    expect(text.indexOf("pairing.connectionMethods.otherWays")).toBeGreaterThan(
      text.indexOf("pairing.connectionMethods.pasteLink.title"),
    );
    expect(text.indexOf("pairing.connectionMethods.otherWays")).toBeLessThan(
      text.indexOf("pairing.connectionMethods.direct.title"),
    );
  });

  it("on web, where no QR can be scanned, the pairing link says it uses Tailscale or relay", () => {
    renderMethods();
    expect(rowOrder()).toEqual(["paste", "direct"]);
    expect(screen.getByText("pairing.connectionMethods.scanQr.description")).toBeTruthy();
    expect(screen.queryByText("pairing.connectionMethods.pasteLink.description")).toBeNull();
  });

  it("beside the QR row, the pairing link refers to it", () => {
    env.isNative = true;
    renderMethods();
    expect(screen.getByText("pairing.connectionMethods.pasteLink.description")).toBeTruthy();
    expect(screen.getAllByText("pairing.connectionMethods.scanQr.description")).toHaveLength(1);
  });

  it("drops QR on F-Droid and adds Remote SSH on the desktop app", () => {
    env.isNative = true;
    env.isFdroid = true;
    env.isElectron = true;
    renderMethods();
    expect(rowOrder()).toEqual(["paste", "direct", "ssh"]);
  });

  it("draws each way as a lifted settings card, neutral, that answers hover", () => {
    renderMethods();
    for (const testID of ["paste", "direct"]) {
      const card = screen.getByTestId(testID);
      expect(JSON.parse(card.getAttribute("data-style")!)).toEqual([
        "settingsCard",
        "card",
        false,
        false,
      ]);
      expect(card.getAttribute("data-hover-style")).toContain("hovered");
    }
  });

  it("each row runs its own action", () => {
    env.isNative = true;
    env.isElectron = true;
    renderMethods();
    fireEvent.click(screen.getByTestId("scan"));
    fireEvent.click(screen.getByTestId("paste"));
    fireEvent.click(screen.getByTestId("direct"));
    fireEvent.click(screen.getByTestId("ssh"));
    for (const handler of Object.values(handlers)) expect(handler).toHaveBeenCalledTimes(1);
  });
});
