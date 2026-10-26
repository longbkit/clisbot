import { i18n } from "@/i18n/i18next";
/**
 * What the status trigger says. "n/44+" is deliberate: it shows how many agents Clisbot can run,
 * not only the ones ready here. `warning` marks a state the user should act on.
 */
export function startStatusLabel(
  status: string,
  readyCount: number,
  supportedCount: number,
): { label: string; warning: boolean } {
  if (status === "online") {
    const label = i18n.t("home.startStatus.agentsReady", {
      ready: readyCount,
      supported: supportedCount,
    });
    return readyCount === 0
      ? { label: `${label} · ${i18n.t("home.startStatus.setUp")}`, warning: true }
      : { label, warning: false };
  }
  if (status === "connecting" || status === "idle")
    return { label: i18n.t("home.startStatus.connecting"), warning: false };
  return { label: i18n.t("home.startStatus.hostOffline"), warning: true };
}
