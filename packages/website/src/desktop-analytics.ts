// A public, bounded ingest endpoint. The Measurement Protocol secret stays in
// a Worker secret; no prompts, paths, titles, identities or raw URLs are accepted.
const SCREENS = new Set([
  "home",
  "welcome",
  "settings",
  "new_agent",
  "agent",
  "workspace",
  "project",
  "bot",
  "chat",
  "automations",
  "schedules",
  "cli_login",
  "other",
]);
const ORIGINS = new Set(["clisbot://app", "null"]);
type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (v: RecordValue, expected: string[]) =>
  Object.keys(v).sort().join() === expected.sort().join();

export interface DesktopAnalyticsEnv {
  GA4_DESKTOP_MEASUREMENT_ID?: string;
  GA4_DESKTOP_API_SECRET?: string;
  DESKTOP_ANALYTICS_LIMITER?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
}
function validDesktopAnalyticsMetadata(value: RecordValue, now: number): boolean {
  if (typeof value.client_id !== "string" || !/^[1-9]\d{0,9}\.[1-9]\d{0,9}$/.test(value.client_id))
    return false;
  if (
    typeof value.session_id !== "number" ||
    !Number.isSafeInteger(value.session_id) ||
    value.session_id < Math.floor(now / 1000) - 86400 ||
    value.session_id > Math.floor(now / 1000) + 60
  )
    return false;
  if (
    typeof value.app_version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/.test(value.app_version) ||
    value.app_version.length > 40
  )
    return false;
  return true;
}

export function desktopAnalyticsPayload(value: unknown, now: number): RecordValue | null {
  if (!record(value) || !keys(value, ["client_id", "session_id", "app_version", "event"]))
    return null;
  if (!validDesktopAnalyticsMetadata(value, now)) return null;
  const event = value.event;
  if (!record(event)) return null;
  const params: RecordValue = {
    surface: "app",
    client_platform: "electron",
    app_version: value.app_version,
    session_id: value.session_id,
    engagement_time_msec: 1,
  };
  let name: string;
  if (event.name === "app_open" && keys(event, ["name"])) name = "app_open";
  else if (
    event.name === "screen_view" &&
    keys(event, ["name", "screen"]) &&
    typeof event.screen === "string" &&
    SCREENS.has(event.screen)
  ) {
    name = "page_view";
    params.screen_name = event.screen;
    params.page_title = event.screen;
    params.page_location = `https://clisbot.com/desktop/screens/${event.screen}`;
  } else if (
    event.name === "engagement" &&
    keys(event, ["name", "milliseconds"]) &&
    typeof event.milliseconds === "number" &&
    Number.isInteger(event.milliseconds) &&
    event.milliseconds > 0 &&
    event.milliseconds <= 30_000
  ) {
    name = "user_engagement";
    params.engagement_time_msec = event.milliseconds;
  } else return null;
  return {
    client_id: value.client_id,
    consent: { ad_user_data: "DENIED", ad_personalization: "DENIED" },
    non_personalized_ads: true,
    events: [{ name, params }],
  };
}

async function boundedBody(request: Request): Promise<string> {
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1024) {
        await reader.cancel();
        throw new Error("Body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function collectDesktopAnalytics(
  request: Request,
  env: DesktopAnalyticsEnv,
  send: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<Response> {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    vary: "origin",
  };
  if (origin !== null && !ORIGINS.has(origin)) return new Response(null, { status: 403, headers });
  if (origin !== null) headers["access-control-allow-origin"] = origin;
  if (request.method === "OPTIONS") {
    headers["access-control-allow-methods"] = "POST";
    headers["access-control-allow-headers"] = "content-type";
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") return new Response(null, { status: 405, headers });
  if (
    !env.GA4_DESKTOP_API_SECRET ||
    !env.GA4_DESKTOP_MEASUREMENT_ID ||
    !env.DESKTOP_ANALYTICS_LIMITER
  )
    return new Response(null, { status: 503, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return new Response(null, { status: 415, headers });
  try {
    const allowed = await env.DESKTOP_ANALYTICS_LIMITER.limit({
      key: request.headers.get("cf-connecting-ip") ?? "unknown",
    });
    if (!allowed.success) return new Response(null, { status: 429, headers });
    const payload = desktopAnalyticsPayload(JSON.parse(await boundedBody(request)), now);
    if (!payload) return new Response(null, { status: 400, headers });
    const url = new URL("https://www.google-analytics.com/mp/collect");
    url.searchParams.set("measurement_id", env.GA4_DESKTOP_MEASUREMENT_ID);
    url.searchParams.set("api_secret", env.GA4_DESKTOP_API_SECRET);
    const response = await send(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    return new Response(null, { status: response.ok ? 204 : 502, headers });
  } catch {
    return new Response(null, { status: 400, headers });
  }
}
