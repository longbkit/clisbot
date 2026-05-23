import { join } from "node:path";
import { collapseHomePath, getDefaultCredentialsDir } from "../../infra/paths.ts";

export function buildDefaultZaloPersonalTokenFile(
  botId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  return collapseHomePath(join(
    getDefaultCredentialsDir(env),
    "zalo-personal",
    botId,
    "auth-session",
  ));
}
