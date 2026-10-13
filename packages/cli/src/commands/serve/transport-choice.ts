import { readFileSync } from "node:fs";
import path from "node:path";
import { tailscaleApprovalUrl } from "@clisbot/server/gateway-adapters";
import { writeServiceFile } from "../../utils/service-files.js";

// Relay.enabled can be inherited from old automatic fallback. Only a saved choice
// identifies the route the operator selected, independently of available transports.
export function readTransportChoice(home: string): string | undefined {
  try {
    const value = JSON.parse(readFileSync(path.join(home, "transport-choice.json"), "utf8"));
    return ["tailscale", "relay", "local"].includes(value.transport) ? value.transport : undefined;
  } catch {
    return undefined;
  }
}

export function saveTransportChoice(home: string, transport: string): void {
  // Public HTTPS also needs an origin; keep requiring its explicit deployment options.
  if (["tailscale", "relay", "local"].includes(transport))
    writeServiceFile(path.join(home, "transport-choice.json"), { transport });
}

export function tailscaleSetupError(home: string, error: unknown, hub = false): Error {
  const stderr = (error as { stderr?: unknown } | null)?.stderr;
  let reason = error instanceof Error ? error.message : String(error);
  if (typeof stderr === "string" && stderr.trim()) reason = stderr.trim();
  const quote =
    process.platform === "win32"
      ? `"${home.replaceAll('"', '\\"')}"`
      : `'${home.replaceAll("'", "'\\''")}'`;
  const command = hub ? "hub start --personal" : "onboard";
  const retryCommand = `clisbot ${command} --home ${quote} --transport tailscale`;
  const relayCommand = `clisbot ${command} --home ${quote} ${hub ? "--transport relay" : "--relay"}`;
  const approvalUrl = tailscaleApprovalUrl(error);
  return Object.assign(
    new Error(
      `Tailscale could not expose this ${hub ? "Hub" : "Host"}: ${reason}\n\n` +
        "Check that Tailscale is running and signed in, and that Serve is enabled. " +
        "Existing services and mappings were preserved; no automatic switch to relay was made.\n" +
        (approvalUrl ? `Enable Serve: ${approvalUrl}\n` : "") +
        `Retry: ${retryCommand}\n\n` +
        "Tailscale is recommended for a direct connection and usually lower latency. " +
        "Alternatively, Clisbot's hosted relay uses end-to-end encryption and is currently provided free of charge:\n" +
        relayCommand,
    ),
    {
      code: "TAILSCALE_SETUP_REQUIRED",
      details: { reason, retryCommand, relayCommand, approvalUrl },
    },
  );
}
