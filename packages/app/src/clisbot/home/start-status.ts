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
    const label = `${readyCount}/${supportedCount}+ agents ready`;
    return readyCount === 0
      ? { label: `${label} · Set up`, warning: true }
      : { label, warning: false };
  }
  if (status === "connecting" || status === "idle") return { label: "Connecting…", warning: false };
  return { label: "Host offline", warning: true };
}
