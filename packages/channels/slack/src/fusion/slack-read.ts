// Fusion helpers shared by the Slack reads the Hub depends on: the thread read
// action (D-046) and the thread snapshot taken at admission
// (transport/thread-context.ts).

/** Slack ts order without float rounding: whole seconds, then the padded fraction. */
export function compareSlackTs(a: string, b: string): number {
  const [aSec = "0", aFrac = ""] = a.split(".");
  const [bSec = "0", bFrac = ""] = b.split(".");
  const seconds = BigInt(aSec) - BigInt(bSec);
  if (seconds !== 0n) return seconds < 0n ? -1 : 1;
  const width = Math.max(aFrac.length, bFrac.length);
  const fraction =
    BigInt(aFrac.padEnd(width, "0") || "0") - BigInt(bFrac.padEnd(width, "0") || "0");
  return fraction === 0n ? 0 : fraction < 0n ? -1 : 1;
}

/** The Slack error a failed Web API call reports: the platform error, else the SDK code. */
export function slackErrorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const data = (err as { data?: { error?: unknown } }).data;
    if (typeof data?.error === "string" && data.error !== "") return data.error;
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code !== "") return code;
  }
  return "read_failed";
}
