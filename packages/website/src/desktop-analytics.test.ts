import { describe, expect, it } from "vitest";
import {
  collectDesktopAnalytics,
  desktopAnalyticsPayload,
  type DesktopAnalyticsEnv,
} from "./desktop-analytics";

const now = 1_800_000_000_000;
const input = {
  client_id: "12345678.1800000000",
  session_id: now / 1000,
  app_version: "0.10.2",
  event: { name: "screen_view", screen: "agent" },
};
const env: DesktopAnalyticsEnv = {
  GA4_DESKTOP_MEASUREMENT_ID: "G-TEST",
  GA4_DESKTOP_API_SECRET: "test-only",
  DESKTOP_ANALYTICS_LIMITER: { limit: async () => ({ success: true }) },
};
const request = (body: unknown, origin = "clisbot://app") =>
  new Request("https://clisbot.com/api/analytics/desktop", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
describe("desktop analytics collector", () => {
  it("reconstructs approved usage fields with a synthetic public screen URL", () => {
    expect(desktopAnalyticsPayload(input, now)).toEqual({
      client_id: input.client_id,
      consent: { ad_user_data: "DENIED", ad_personalization: "DENIED" },
      non_personalized_ads: true,
      events: [
        {
          name: "page_view",
          params: {
            surface: "app",
            client_platform: "electron",
            app_version: "0.10.2",
            session_id: now / 1000,
            engagement_time_msec: 1,
            screen_name: "agent",
            page_title: "agent",
            page_location: "https://clisbot.com/desktop/screens/agent",
          },
        },
      ],
    });
  });
  it("rejects extra data, raw paths, invalid IDs and stale sessions", () => {
    expect(desktopAnalyticsPayload({ ...input, prompt: "secret" }, now)).toEqual(null);
    expect(
      desktopAnalyticsPayload(
        { ...input, event: { ...input.event, screen: "/private/path" } },
        now,
      ),
    ).toEqual(null);
    expect(desktopAnalyticsPayload({ ...input, client_id: "person@example.com" }, now)).toEqual(
      null,
    );
    expect(
      desktopAnalyticsPayload({ ...input, client_id: "12345678-1234-4123-8123-123456789abc" }, now),
    ).toEqual(null);
    expect(desktopAnalyticsPayload({ ...input, session_id: now / 1000 - 86401 }, now)).toEqual(
      null,
    );
  });
  it("keeps the API secret server-side and forwards a valid payload", async () => {
    const received: { url: string; body: unknown }[] = [];
    const sender: typeof fetch = async (url, init) => {
      received.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 204 });
    };
    const response = await collectDesktopAnalytics(request(input), env, sender, now);
    expect(response.status).toEqual(204);
    expect(await response.text()).toEqual("");
    expect(response.headers.get("access-control-allow-origin")).toEqual("clisbot://app");
    expect(received).toEqual([
      {
        url: "https://www.google-analytics.com/mp/collect?measurement_id=G-TEST&api_secret=test-only",
        body: desktopAnalyticsPayload(input, now),
      },
    ]);
  });
  it("blocks unapproved origins and rate-limited traffic before forwarding", async () => {
    const sender: typeof fetch = async () => {
      throw new Error("Must not forward");
    };
    expect(
      (await collectDesktopAnalytics(request(input, "https://evil.example"), env, sender, now))
        .status,
    ).toEqual(403);
    const limited = {
      ...env,
      DESKTOP_ANALYTICS_LIMITER: { limit: async () => ({ success: false }) },
    };
    expect((await collectDesktopAnalytics(request(input), limited, sender, now)).status).toEqual(
      429,
    );
  });
  it("fails closed without credentials and bounds request bodies", async () => {
    expect((await collectDesktopAnalytics(request(input), {}, undefined, now)).status).toEqual(503);
    expect(
      (
        await collectDesktopAnalytics(
          request({ ...input, padding: "x".repeat(1024) }),
          env,
          undefined,
          now,
        )
      ).status,
    ).toEqual(400);
  });
});
