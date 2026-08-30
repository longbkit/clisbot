// COMPAT(clisbot-bot): shared home resolution for the `bot` verbs. The `--home`
// flag (or the CLISBOT_HOME/PASEO_HOME env) picks the shared Clisbot home the
// manifest, daemon, and embedded Hub live under.

import type { CommandOptions } from "../../output/index.js";
import { resolveLocalHubHome } from "../hub/local-hub.js";

/** The `--home` flag (or env) resolves the shared Clisbot home a bot lives under. */
export function resolveBotHome(options: CommandOptions): string {
  const home =
    typeof options.home === "string" && options.home.trim() !== "" ? options.home : undefined;
  return resolveLocalHubHome({ home }, process.env);
}
