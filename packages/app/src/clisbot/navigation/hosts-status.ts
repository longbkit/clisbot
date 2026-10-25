import { useHostsStrip } from "@/clisbot/home/hosts-strip-data";

/** One status for every Host and Hub: the Hosts dot on the rail and on the More tab. */
export function useHostsStatus(): "online" | "connecting" | "error" {
  const { issues, summary } = useHostsStrip();
  if (issues.length > 0) return "error";
  return summary.online === summary.total ? "online" : "connecting";
}
