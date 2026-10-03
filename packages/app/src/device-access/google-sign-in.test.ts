// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import {
  acquireGoogleIdToken,
  prepareGooglePopup,
  officialHubConnectionUrl,
  parsePublicHubConnection,
} from "./google-sign-in";
const state = vi.hoisted(() => ({
  os: "web",
  browser: vi.fn(),
  desktop: null as null | { google: { signIn: ReturnType<typeof vi.fn> } },
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return state.os;
    },
  },
}));
vi.mock("@/desktop/host", () => ({ getDesktopHost: () => state.desktop }));
vi.mock("expo-linking", () => ({ createURL: () => "clisbot://hub-google" }));
vi.mock("expo-web-browser", () => ({ openAuthSessionAsync: state.browser }));
const input = {
  clientId: "official-client",
  nonce: "server-issued-nonce",
  transactionId: "transaction-one",
};
afterEach(() => {
  vi.restoreAllMocks();
  state.os = "web";
  state.desktop = null;
  state.browser.mockReset();
});
test("popup token handoff requires the trusted page, opened window and exact transaction", async () => {
  const popup = {
    location: { href: "about:blank" },
    closed: false,
    close: vi.fn(),
  } as unknown as Window;
  vi.spyOn(window, "open").mockReturnValue(popup);
  const prepared = prepareGooglePopup();
  expect(prepared).toBe(popup);
  let settled = false;
  const token = acquireGoogleIdToken(input, prepared).then((value) => {
    settled = true;
    return value;
  });
  const send = (origin: string, source: Window, transactionId: string) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin,
        source,
        data: { type: "clisbot.google.id-token", transactionId, idToken: "signed-token" },
      }),
    );
  send("https://evil.example", popup, input.transactionId);
  send("https://app.clisbot.com", window, input.transactionId);
  send("https://app.clisbot.com", popup, "other-transaction");
  await Promise.resolve();
  expect(settled).toBe(false);
  send("https://app.clisbot.com", popup, input.transactionId);
  await expect(token).resolves.toBe("signed-token");
  expect(popup.close).toHaveBeenCalled();
  const auth = new URL(popup.location.href);
  expect(auth.search).toBe("");
  expect(new URLSearchParams(auth.hash.slice(1)).get("nonce")).toBe(input.nonce);
});
test("native handoff rejects a token from a different transaction or callback", async () => {
  state.os = "ios";
  state.browser.mockResolvedValue({
    type: "success",
    url: "clisbot://hub-google#transactionId=other&idToken=signed-token",
  });
  await expect(acquireGoogleIdToken(input)).rejects.toThrow("did not match");
  state.browser.mockResolvedValue({
    type: "success",
    url: "clisbot://unexpected#transactionId=transaction-one&idToken=signed-token",
  });
  await expect(acquireGoogleIdToken(input)).rejects.toThrow("unexpected app route");
  state.browser.mockResolvedValue({
    type: "success",
    url: "clisbot://hub-google#transactionId=transaction-one&idToken=signed-token",
  });
  await expect(acquireGoogleIdToken(input)).resolves.toBe("signed-token");
});
test("Desktop handoff uses the main-process bridge and verifies transaction", async () => {
  const signIn = vi.fn().mockResolvedValue({ transactionId: "other", idToken: "signed-token" });
  state.desktop = { google: { signIn } };
  await expect(acquireGoogleIdToken(input)).rejects.toThrow("did not match");
  signIn.mockResolvedValue({ transactionId: input.transactionId, idToken: "signed-token" });
  await expect(acquireGoogleIdToken(input)).resolves.toBe("signed-token");
});

test("self-host Google handoff shares only public Hub identity and routes", () => {
  const target = {
    hubId: "hub-one",
    publicKey: "public-key",
    origin: "https://home.example.test",
    relay: { endpoint: "relay.example.test", useTls: true },
    pairing: { backendId: "hub-one", token: "pair-secret", expiresAt: Date.now() + 30_000 },
    ownerSetupToken: "setup-secret",
  };
  const url = new URL(officialHubConnectionUrl(target));
  expect(url.origin).toBe("https://app.clisbot.com");
  expect(url.search).toBe("");
  const value = parsePublicHubConnection(new URLSearchParams(url.hash.slice(1)).get("hub")!);
  expect(value).toEqual({
    hubId: target.hubId,
    publicKey: target.publicKey,
    origin: target.origin,
    relay: target.relay,
  });
  expect(JSON.stringify(value)).not.toContain("secret");
});
