import AsyncStorage from "@react-native-async-storage/async-storage";
import { getIsElectron } from "@/constants/platform";
import { resolveAppVersion } from "@/utils/app-version";
import { analyticsAvailable, DESKTOP_COLLECTOR, WEB_MEASUREMENT_ID } from "./config";
import type { AnalyticsAdapter } from "./model";

const ID_KEY = "clisbot:desktop-analytics-id:v1";
type Gtag = (...args: unknown[]) => void;
let gtag: Gtag | undefined;
function googleTag(): Gtag {
  if (gtag) return gtag;
  const target = window as unknown as { dataLayer: unknown[]; gtag: Gtag };
  target.dataLayer ??= [];
  gtag = target.gtag = function () {
    target.dataLayer.push(arguments);
  };
  gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  gtag("js", new Date());
  gtag("config", WEB_MEASUREMENT_ID, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    surface: "app",
    client_platform: "web",
    app_version: resolveAppVersion(),
    page_location: "https://app.clisbot.com/",
    page_referrer: "",
    page_title: "Clisbot App",
  });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${WEB_MEASUREMENT_ID}`;
  document.head.appendChild(script);
  return gtag;
}
function clearCookies() {
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.trim().split("=")[0];
    if (!name.startsWith("_ga")) continue;
    for (const domain of ["", ";domain=app.clisbot.com", ";domain=.clisbot.com"]) {
      document.cookie = `${name}=;Max-Age=0;path=/${domain}`;
    }
  }
}

export function createAnalyticsAdapter(): AnalyticsAdapter {
  let enabled = false;
  let clientId: string | null = null;
  let sessionId = 0;
  let lastEvent = 0;
  const pending = new Set<AbortController>();
  return {
    async setEnabled(value) {
      const wasEnabled = enabled;
      enabled = false;
      pending.forEach((controller) => controller.abort());
      pending.clear();
      const desktop = getIsElectron();
      if (!analyticsAvailable || (!desktop && window.location.hostname !== "app.clisbot.com")) {
        if (value) throw new Error("Analytics unavailable on this origin");
        return;
      }
      if (desktop) {
        if (value) {
          clientId = await AsyncStorage.getItem(ID_KEY);
          if (!clientId || !/^[1-9]\d{0,9}\.[1-9]\d{0,9}$/.test(clientId)) {
            // GA4's web Measurement Protocol accepts two positive numeric parts.
            clientId = Array.from(crypto.getRandomValues(new Uint32Array(2)), (part) =>
              String(part || 1),
            ).join(".");
            await AsyncStorage.setItem(ID_KEY, clientId);
          }
          sessionId = Math.floor(Date.now() / 1000);
        } else {
          clientId = null;
          await AsyncStorage.removeItem(ID_KEY);
        }
      } else {
        Reflect.set(window, `ga-disable-${WEB_MEASUREMENT_ID}`, !value);
        if (value) googleTag()("consent", "update", { analytics_storage: "granted" });
        else {
          gtag?.("consent", "update", { analytics_storage: "denied" });
          if (wasEnabled) clearCookies();
        }
      }
      enabled = value;
    },
    async send(event) {
      if (!enabled) return;
      if (getIsElectron()) {
        if (!clientId) return;
        const now = Date.now();
        if (now - lastEvent > 30 * 60_000) sessionId = Math.floor(now / 1000);
        lastEvent = now;
        const controller = new AbortController();
        pending.add(controller);
        const timeout = setTimeout(() => controller.abort(), 5_000);
        try {
          await fetch(DESKTOP_COLLECTOR, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "omit",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
            body: JSON.stringify({
              client_id: clientId,
              session_id: sessionId,
              app_version: resolveAppVersion(),
              event,
            }),
          });
        } finally {
          clearTimeout(timeout);
          pending.delete(controller);
        }
      } else {
        const common = {
          send_to: WEB_MEASUREMENT_ID,
          surface: "app",
          client_platform: "web",
          app_version: resolveAppVersion(),
        };
        if (event.name === "screen_view") {
          googleTag()("event", "page_view", {
            ...common,
            screen_name: event.screen,
            page_title: event.screen,
            page_location: `https://app.clisbot.com/screens/${event.screen}`,
            page_referrer: "",
          });
        } else if (event.name === "app_open") {
          googleTag()("event", "app_open", common);
        }
        // gtag owns browser engagement duration; do not emit a duplicate heartbeat.
      }
    },
  };
}
