import { existsSync } from "node:fs";
import path from "node:path";
import { readPersistedConfig } from "@clisbot/server/configuration";
import { resolveClisbotHome } from "@clisbot/server/daemon-control";

/** New personal homes opt into protected daemon admission; existing deployments retain policy. */
export function isPersonalServingHome(env = process.env): boolean {
  if (env.CLISBOT_PERSONAL_SERVE !== undefined)
    return /^(1|true)$/i.test(env.CLISBOT_PERSONAL_SERVE);
  const home = resolveClisbotHome(env);
  if (!existsSync(path.join(home, "config.json"))) return true;
  return readPersistedConfig(home).features?.personalServing === true;
}
