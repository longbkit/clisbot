import { useLocation } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

const MEASUREMENT_ID = "G-YB48G0QD0C";
const CONSENT_KEY = "clisbot:website-analytics-consent";
const SETTINGS_EVENT = "clisbot:analytics-settings";
type Consent = "accepted" | "declined";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function openAnalyticsSettings() {
  window.dispatchEvent(new Event(SETTINGS_EVENT));
}

function startAnalytics() {
  Reflect.set(window, `ga-disable-${MEASUREMENT_ID}`, false);
  if (document.getElementById("clisbot-google-tag")) return;
  window.dataLayer ??= [];
  window.gtag = function () {
    window.dataLayer!.push(arguments);
  };
  window.gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  window.gtag("js", new Date());
  window.gtag("config", MEASUREMENT_ID, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    surface: "website",
    client_platform: "web",
    page_location: `${location.origin}${location.pathname}`,
    page_referrer: document.referrer ? new URL(document.referrer).origin : "",
  });
  const script = document.createElement("script");
  script.id = "clisbot-google-tag";
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);
}

function stopAnalytics() {
  Reflect.set(window, `ga-disable-${MEASUREMENT_ID}`, true);
  window.gtag?.("consent", "update", { analytics_storage: "denied" });
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (!name?.startsWith("_ga")) continue;
    for (const domain of ["", "; domain=clisbot.com", "; domain=.clisbot.com"]) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain}`;
    }
  }
}

export function WebsiteAnalytics() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const [consent, setConsent] = useState<Consent | null>(null);
  const [visible, setVisible] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const enabled = !import.meta.env.DEV;

  useEffect(() => {
    if (!enabled || !["clisbot.com", "www.clisbot.com"].includes(location.hostname)) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(CONSENT_KEY);
    } catch {
      // An unavailable storage still permits a choice for the current page.
    }
    setConsent(saved === "accepted" || saved === "declined" ? saved : null);
    setVisible(saved !== "accepted" && saved !== "declined");
    const open = () => setVisible(true);
    window.addEventListener(SETTINGS_EVENT, open);
    return () => window.removeEventListener(SETTINGS_EVENT, open);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || consent !== "accepted") return;
    startAnalytics();
    window.gtag?.("consent", "update", { analytics_storage: "granted" });
    const frame = requestAnimationFrame(() => {
      window.gtag?.("event", "page_view", {
        send_to: MEASUREMENT_ID,
        page_location: `${location.origin}${pathname}`,
        page_title: document.title,
        page_referrer: document.referrer ? new URL(document.referrer).origin : "",
        surface: "website",
        client_platform: "web",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [consent, enabled, pathname]);

  const choose = useCallback((value: Consent) => {
    if (value === "declined") stopAnalytics();
    try {
      localStorage.setItem(CONSENT_KEY, value);
      setStorageError(false);
      setVisible(false);
    } catch {
      setStorageError(true);
    }
    setConsent(value);
  }, []);
  const rejectAnalytics = useCallback(() => choose("declined"), [choose]);
  const acceptAnalytics = useCallback(() => choose("accepted"), [choose]);

  if (!visible) return null;
  return (
    <aside
      aria-label="Cookie preferences"
      className="fixed bottom-4 left-4 right-4 z-50 max-w-md rounded-xl border border-white/20 bg-background p-5 shadow-xl"
    >
      <p className="mb-2 font-medium">Cookie preferences</p>
      <p className="text-sm text-muted-foreground">
        We use optional analytics cookies to understand visits to clisbot.com. Your choice is
        optional and can be changed in Cookie settings.{" "}
        <a className="underline" href="/privacy">
          Privacy policy
        </a>
      </p>
      {storageError ? (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          Your choice applies to this page. This browser could not save it for future visits.
        </p>
      ) : null}
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          className="rounded-md border border-white/20 px-4 py-2 text-sm"
          onClick={rejectAnalytics}
        >
          Reject optional
        </button>
        <button
          type="button"
          className="rounded-md bg-foreground px-4 py-2 text-sm text-background"
          onClick={acceptAnalytics}
        >
          Accept analytics cookies
        </button>
      </div>
    </aside>
  );
}
