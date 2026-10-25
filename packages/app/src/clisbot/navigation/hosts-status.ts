import { useHostsStrip } from "@/clisbot/home/hosts-strip-data";

/** One status for every Host and Hub: the Hosts dot on the rail and on the More tab. */
export function useHostsStatus(): "online" | "connecting" | "error" {
  const { issues, summary } = useHostsStrip();
  if (issues.length > 0) return "error";
  return summary.online === summary.total ? "online" : "connecting";
}

/**
 * Whether any Host can fill a list right now. `connecting`: none online yet, nothing has failed,
 * so a list shows its skeleton. `unreachable`: none online and the runtime has given up for now,
 * so a list says so instead of loading forever.
 */
export function useHostsReachability(): "online" | "connecting" | "unreachable" {
  const { issues, summary } = useHostsStrip();
  if (summary.online > 0 || summary.total === 0) return "online";
  return issues.length > 0 ? "unreachable" : "connecting";
}
