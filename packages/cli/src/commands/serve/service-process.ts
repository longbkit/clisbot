import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nodeEntrypointArguments } from "../../utils/node-entrypoint.js";

export function serviceSupervisorArguments(
  worker: string,
  args: string[] = [],
  controlFile?: string,
): string[] {
  const built = fileURLToPath(new URL("./service-supervisor-entry.js", import.meta.url));
  const entry = existsSync(built)
    ? built
    : fileURLToPath(new URL("./service-supervisor-entry.ts", import.meta.url));
  return nodeEntrypointArguments(entry, [
    ...(controlFile ? ["--control-file", controlFile] : []),
    worker,
    ...args,
  ]);
}
