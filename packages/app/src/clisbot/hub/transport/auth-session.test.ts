import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  AuthSessions,
  HubSignInReplacedError,
  HubSignInStartError,
  REDIRECT_GRACE_MS,
  type AuthBrowser,
} from "./auth-session";

const REDIRECT = "clisbot://hub-auth/callback";

/** An in-memory browser: records what was opened and lets the test play the OS events. */
function createBrowser() {
  const redirectListeners = new Set<(url: string) => void>();
  const appStateListeners = new Set<(state: string) => void>();
  const opened: string[] = [];
  let dismissals = 0;
  let failNextOpen: Error | null = null;
  const browser: AuthBrowser = {
    open: async (url) => {
      if (failNextOpen) {
        const error = failNextOpen;
        failNextOpen = null;
        throw error;
      }
      opened.push(url);
    },
    dismiss: () => {
      dismissals += 1;
    },
    subscribeRedirect: (listener) => {
      redirectListeners.add(listener);
      return () => redirectListeners.delete(listener);
    },
    subscribeAppState: (listener) => {
      appStateListeners.add(listener);
      return () => appStateListeners.delete(listener);
    },
  };
  return {
    browser,
    opened,
    dismissals: () => dismissals,
    listeners: () => redirectListeners.size + appStateListeners.size,
    failNextOpen: (error: Error) => {
      failNextOpen = error;
    },
    redirect: (url: string) => {
      for (const listener of redirectListeners) listener(url);
    },
    appState: (state: string) => {
      for (const listener of appStateListeners) listener(state);
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("the redirect back to the app completes the sign-in", async () => {
  const fake = createBrowser();
  const result = new AuthSessions(fake.browser).open("https://hub.test/authorize", REDIRECT);
  await vi.advanceTimersByTimeAsync(0);
  fake.appState("background");
  fake.redirect(`${REDIRECT}?code=one-use`);
  expect(await result).toEqual({ type: "success", url: `${REDIRECT}?code=one-use` });
  expect(fake.listeners()).toBe(0);
});

test("a redirect that lands just after the app is active again still completes", async () => {
  const fake = createBrowser();
  const result = new AuthSessions(fake.browser).open("https://hub.test/authorize", REDIRECT);
  await vi.advanceTimersByTimeAsync(0);
  fake.appState("background");
  fake.appState("active");
  await vi.advanceTimersByTimeAsync(REDIRECT_GRACE_MS / 2);
  fake.redirect(`${REDIRECT}?code=late`);
  expect(await result).toEqual({ type: "success", url: `${REDIRECT}?code=late` });
});

test("closing the browser ends the sign-in instead of leaving it registered", async () => {
  const fake = createBrowser();
  const result = new AuthSessions(fake.browser).open("https://hub.test/authorize", REDIRECT);
  await vi.advanceTimersByTimeAsync(0);
  fake.appState("background");
  fake.appState("active");
  await vi.advanceTimersByTimeAsync(REDIRECT_GRACE_MS);
  expect(await result).toEqual({ type: "cancel" });
  expect(fake.listeners()).toBe(0);
});

test("an active state before the browser took the foreground does not end the sign-in", async () => {
  const fake = createBrowser();
  const sessions = new AuthSessions(fake.browser);
  const result = sessions.open("https://hub.test/authorize", REDIRECT);
  fake.appState("active");
  await vi.advanceTimersByTimeAsync(REDIRECT_GRACE_MS * 2);
  fake.redirect(`${REDIRECT}?code=one-use`);
  expect(await result).toMatchObject({ type: "success" });
});

test("a press while an earlier session is still registered dismisses it and opens a new one", async () => {
  const fake = createBrowser();
  const sessions = new AuthSessions(fake.browser);
  const stale = sessions.open("https://hub.test/authorize?state=1", REDIRECT);
  await vi.advanceTimersByTimeAsync(0);
  const fresh = sessions.open("https://hub.test/authorize?state=2", REDIRECT);
  await expect(stale).rejects.toBeInstanceOf(HubSignInReplacedError);
  await vi.advanceTimersByTimeAsync(0);
  expect(fake.dismissals()).toBe(1);
  expect(fake.opened).toEqual([
    "https://hub.test/authorize?state=1",
    "https://hub.test/authorize?state=2",
  ]);
  fake.redirect(`${REDIRECT}?code=fresh`);
  expect(await fresh).toEqual({ type: "success", url: `${REDIRECT}?code=fresh` });
  expect(fake.listeners()).toBe(0);
});

test("a browser that cannot open fails with a start error, and the next press opens again", async () => {
  const fake = createBrowser();
  const sessions = new AuthSessions(fake.browser);
  fake.failNextOpen(new Error("No browser activity"));
  await expect(sessions.open("https://hub.test/authorize", REDIRECT)).rejects.toBeInstanceOf(
    HubSignInStartError,
  );
  expect(fake.listeners()).toBe(0);
  const retry = sessions.open("https://hub.test/authorize", REDIRECT);
  await vi.advanceTimersByTimeAsync(0);
  expect(fake.opened).toEqual(["https://hub.test/authorize"]);
  expect(fake.dismissals()).toBe(0);
  fake.redirect(`${REDIRECT}?code=retry`);
  expect(await retry).toMatchObject({ type: "success" });
});
