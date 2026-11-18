import { describe, expect, it } from "vitest";
import {
  GoogleSignInInputSchema,
  googleSignInUrl,
  openGoogleAuthCallback,
} from "./google-auth-callback.js";

describe("system-browser Google handoff", () => {
  it("keeps authentication material out of URL queries and fixes the trusted auth origin", () => {
    const input = {
      clientId: "123.apps.googleusercontent.com",
      transactionId: "t".repeat(32),
      hubId: "hub-one",
      hubKey: "aHViLW9uZS1lMmVlLXB1YmxpYy1rZXktZml4dHVyZTA=",
    };
    const url = new URL(
      googleSignInUrl(input, "http://127.0.0.1:9000/hub-google/callback/" + "x".repeat(43)),
    );
    expect(url.origin).toBe("https://app.clisbot.com");
    expect(url.search).toBe("");
    const fragment = new URLSearchParams(url.hash.slice(1));
    expect(fragment.get("hubId")).toBe(input.hubId);
    expect(fragment.get("hubKey")).toBe(input.hubKey);
    // CB-04: the page derives the nonce from the pinned Hub identity; none is forwarded.
    expect(fragment.has("nonce")).toBe(false);
    expect(GoogleSignInInputSchema.safeParse({ ...input, nonce: "n".repeat(43) }).success).toBe(
      false,
    );
    expect(
      GoogleSignInInputSchema.safeParse({
        ...input,
        authUrl: "https://evil.invalid",
      }).success,
    ).toBe(false);
  });

  it("binds loopback response to one transaction, rejects foreign origins and refuses replay", async () => {
    const transactionId = "t".repeat(32);
    const callback = await openGoogleAuthCallback(transactionId);
    const url = new URL(callback.redirectUri);
    const complete = `${callback.redirectUri}/complete`;
    const send = (id: string, origin = url.origin) =>
      fetch(complete, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          transactionId: id,
          idToken: "google.signed.token",
        }),
      });
    try {
      const page = await fetch(callback.redirectUri);
      expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(await page.text()).toContain("location.hash");
      expect((await send(transactionId, "https://evil.invalid")).status).toBe(403);
      expect((await send("other-transaction")).status).toBe(400);
      expect((await fetch(`${callback.redirectUri}?idToken=leaked`)).status).toBe(404);
      expect((await send(transactionId)).status).toBe(204);
      expect(await callback.result).toEqual({
        transactionId,
        idToken: "google.signed.token",
      });
      expect((await send(transactionId)).status).toBe(409);
    } finally {
      callback.close();
    }
  });

  it("cancels an abandoned browser authorization and closes the listener", async () => {
    const callback = await openGoogleAuthCallback("t".repeat(32), 20);
    await expect(callback.result).rejects.toThrow("timed out");
    await expect(fetch(callback.redirectUri)).rejects.toThrow();
    callback.close();
  });
});
