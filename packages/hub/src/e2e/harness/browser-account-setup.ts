import type { AuthServer } from "../../auth/server.js";

/**
 * Arms exactly one account-setup failure inside the built application, so the browser suite can
 * exercise the server-result error path against real Hub code rather than a faked response.
 *
 * Harness-only, like the fixture GitHub, Discord, and Stripe clients beside it: nothing under
 * `src/` outside this directory imports it, and only `browser-child.ts` — the process the
 * Playwright fixture spawns — ever composes it. The production composition root builds its
 * `AuthServer` without passing through here at all.
 */
export class BrowserAccountSetupFaults {
  private armed = false;

  failNext(): void {
    this.armed = true;
  }

  /** Returns the same capability with one armed failure ahead of the real claim. */
  install(auth: AuthServer): AuthServer {
    const claimInstance = auth.claimInstance?.bind(auth);
    if (claimInstance === undefined) return auth;
    return {
      ...auth,
      claimInstance: (operator, headers) => {
        if (!this.armed) return claimInstance(operator, headers);
        this.armed = false;
        // Thrown where the real thing throws, so the server function answers with its own error
        // result and the browser sees the response it would see from a genuine failure.
        return Promise.reject(new Error("account setup failed"));
      },
    };
  }
}
