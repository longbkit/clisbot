import path from "node:path";

import { resolveClisbotHome } from "../../../clisbot-home.js";

const OPENCODE_HOME_DIRNAME = "opencode-home";

export function resolveOpenCodeHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveClisbotHome(env), OPENCODE_HOME_DIRNAME);
}
