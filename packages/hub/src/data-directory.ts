import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const APPLICATION_DATA_DIRECTORY = "paseo-hub";

interface HubDataDirectoryOptions {
  environment?: Record<string, string | undefined>;
  homeDirectory?: string;
  workingDirectory?: string;
}

/** Resolves the one durable home for the embedded database and generated runtime secrets. */
export function resolveHubDataDirectory(options: HubDataDirectoryOptions = {}): string {
  const environment = options.environment ?? process.env;
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const override = environment["PASEO_HUB_DATA_DIR"];
  if (override !== undefined) return resolve(workingDirectory, override);

  const configuredDataHome = nonEmpty(environment["XDG_DATA_HOME"]);
  const dataHome =
    configuredDataHome !== undefined && isAbsolute(configuredDataHome)
      ? configuredDataHome
      : join(options.homeDirectory ?? homedir(), ".local", "share");
  return join(dataHome, APPLICATION_DATA_DIRECTORY);
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  return value;
}
