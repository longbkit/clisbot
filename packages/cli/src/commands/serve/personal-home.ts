import { existsSync } from "node:fs";
import path from "node:path";
import { editPersistedConfig } from "@clisbot/server/configuration";
import { readDaemonInstance } from "@clisbot/server/daemon-control";
import { onboardingDaemonListen } from "../bot/local-runtime.js";

/** Only pristine personal homes get defaults. Existing identity/policy is never migrated here. */
export async function prepareFreshPersonalHome(
  home: string,
  options: { relay?: boolean } = {},
): Promise<boolean> {
  if (
    ["config.json", "server-id", "daemon-keypair.json"].some((file) =>
      existsSync(path.join(home, file)),
    ) ||
    (await readDaemonInstance(home))
  )
    return false;
  const listen = await onboardingDaemonListen(home, process.env);
  editPersistedConfig(home, "features.devicePairing", { value: true });
  editPersistedConfig(home, "features.personalServing", { value: true });
  editPersistedConfig(home, "daemon.managedAccess.mode", { value: "off" });
  editPersistedConfig(home, "daemon.listen", { value: listen });
  if (options.relay !== undefined)
    editPersistedConfig(home, "daemon.relay.enabled", { value: options.relay });
  return true;
}
