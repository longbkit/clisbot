import { describe, expect, test } from "bun:test";
import { authorizeApiBotRequest } from "../src/channels/api/auth.ts";
import type { ApiAuthConfig } from "../src/channels/api/config.ts";
import { chatwootPayload, hmacHeaders } from "./support/api-channel-helpers.ts";

const hmacConfig: ApiAuthConfig = {
  mode: "hmac",
  secretEnv: "API_TEST_SECRET",
  timestampHeader: "x-ts",
  signatureHeader: "x-sig",
  signaturePrefix: "sha256=",
  signingBase: "{{timestamp}}.{{rawBody}}",
  toleranceSecondsDefault: 300,
};

describe("api auth", () => {
  test("rejects bearer requests with a wrong token", () => {
    expect(authorizeApiBotRequest({
      mode: "bearer",
      tokenEnv: "API_TEST_TOKEN",
    }, {
      headers: new Headers({ authorization: "Bearer wrong-token" }),
      rawBody: "",
      remoteAddress: "203.0.113.10",
      env: { API_TEST_TOKEN: "token-123" } as NodeJS.ProcessEnv,
    })).toBe(false);
  });

  test("rejects hmac requests with a missing signature", () => {
    const body = JSON.stringify(chatwootPayload());
    const timestamp = String(Math.floor(Date.now() / 1000));

    expect(authorizeApiBotRequest(hmacConfig, {
      headers: new Headers({ "x-ts": timestamp }),
      rawBody: body,
      remoteAddress: "203.0.113.10",
      env: { API_TEST_SECRET: "secret" } as NodeJS.ProcessEnv,
    })).toBe(false);
  });

  test("rejects hmac requests outside the timestamp tolerance", () => {
    const body = JSON.stringify(chatwootPayload());
    const now = Date.now();
    const staleTimestamp = String(Math.floor((now - 10 * 60 * 1000) / 1000));

    expect(authorizeApiBotRequest(hmacConfig, {
      headers: new Headers(hmacHeaders({
        body,
        secret: "secret",
        timestamp: staleTimestamp,
      })),
      rawBody: body,
      remoteAddress: "203.0.113.10",
      now,
      env: { API_TEST_SECRET: "secret" } as NodeJS.ProcessEnv,
    })).toBe(false);
  });

  test("rejects hmac requests signed with the wrong secret", () => {
    const body = JSON.stringify(chatwootPayload());

    expect(authorizeApiBotRequest(hmacConfig, {
      headers: new Headers(hmacHeaders({
        body,
        secret: "secret",
        signatureSecret: "wrong-secret",
      })),
      rawBody: body,
      remoteAddress: "203.0.113.10",
      env: { API_TEST_SECRET: "secret" } as NodeJS.ProcessEnv,
    })).toBe(false);
  });
});
