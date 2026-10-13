import { resolveLocalHubState, startLocalHubDetached } from "../hub/local-hub.js";
import { startPersonalHub } from "./index.js";
import { restoreLocalWeb } from "./web.js";

/** A one-shot replay of prior owner intent, never a resurrection loop. Explicit stop wins. */
export async function resumeLocalServices(home: string): Promise<void> {
  const hub = resolveLocalHubState({ home });
  if (hub.state && !hub.running && !hub.state.stoppedAt) {
    if (hub.state.personalComposition) await startPersonalHub({ home, json: true });
    else
      await startLocalHubDetached({
        home,
        port: String(hub.state.port),
        supervise: Boolean(hub.state.controlFile),
      });
  }
  await restoreLocalWeb(home);
}
