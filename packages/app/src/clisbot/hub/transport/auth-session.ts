import { i18n } from "@/i18n/i18next";

/**
 * One browser sign-in at a time for the app. expo-web-browser's Android auth session keeps
 * module-private state and ignores the first AppState change after a cold start, so a session
 * whose browser closed could stay registered: the sign-in never settled and every later press
 * failed with "already open". This owns that state instead, so a press always does something
 * (connection-resilience.md).
 */

/** A redirect can land just after the app is active again; wait this long before giving up. */
export const REDIRECT_GRACE_MS = 1_000;

export type AuthSessionResult = { type: "success"; url: string } | { type: "cancel" };

/** The platform browser, behind a port so the session rules are tested without one. */
export interface AuthBrowser {
  /** Shows the sign-in page; resolves once it is shown. */
  open(url: string): Promise<void>;
  /** Closes a page still shown, where the platform can. */
  dismiss(): void;
  subscribeRedirect(listener: (url: string) => void): () => void;
  subscribeAppState(listener: (state: string) => void): () => void;
}

/** The browser could not be opened; the sign-in never started. */
export class HubSignInStartError extends Error {
  constructor(readonly cause: unknown) {
    super(i18n.t("hub.account.signIn.browserUnavailable"));
    this.name = "HubSignInStartError";
  }
}

/** A newer press replaced this sign-in; the newer one reports the outcome. */
export class HubSignInReplacedError extends Error {
  constructor() {
    super("Replaced by a newer Hub sign-in");
    this.name = "HubSignInReplacedError";
  }
}

type SessionEnd = { result: AuthSessionResult } | { error: Error };

export class AuthSessions {
  private active: ((end: SessionEnd) => void) | null = null;

  constructor(private readonly browser: AuthBrowser) {}

  open(url: string, redirectUrl: string): Promise<AuthSessionResult> {
    if (this.active) {
      this.browser.dismiss();
      this.active({ error: new HubSignInReplacedError() });
    }
    return new Promise((resolve, reject) => {
      let leftApp = false;
      let grace: ReturnType<typeof setTimeout> | null = null;
      const stops: Array<() => void> = [];
      const end = (outcome: SessionEnd) => {
        if (this.active !== end) return;
        this.active = null;
        if (grace) clearTimeout(grace);
        for (const stop of stops) stop();
        if ("error" in outcome) reject(outcome.error);
        else resolve(outcome.result);
      };
      this.active = end;
      stops.push(
        this.browser.subscribeRedirect((callbackUrl) => {
          if (callbackUrl.startsWith(redirectUrl))
            end({ result: { type: "success", url: callbackUrl } });
        }),
        this.browser.subscribeAppState((state) => {
          if (state !== "active") {
            leftApp = true;
            return;
          }
          if (!leftApp || grace) return;
          grace = setTimeout(() => end({ result: { type: "cancel" } }), REDIRECT_GRACE_MS);
        }),
      );
      this.browser
        .open(url)
        .catch((cause: unknown) => end({ error: new HubSignInStartError(cause) }));
    });
  }
}
