import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { ApplicationRuntime } from "./runtime.js";
import { runtimeFile } from "../runtime-files.js";

export interface BuiltStartServer {
  default: { fetch(request: Request): Promise<Response> };
  startApplication(
    factory: () => ApplicationRuntime | Promise<ApplicationRuntime>,
  ): Promise<ApplicationRuntime>;
  startProductionRuntime(): Promise<ApplicationRuntime>;
  stopProductionRuntime(): Promise<void>;
  handleDaemonUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void>;
}

const BuiltStartServerSchema = z.custom<BuiltStartServer>((value) => {
  if (!isObjectRecord(value)) return false;
  const entry = value["default"];
  return (
    isObjectRecord(entry) &&
    typeof entry["fetch"] === "function" &&
    typeof value["startApplication"] === "function" &&
    typeof value["startProductionRuntime"] === "function" &&
    typeof value["stopProductionRuntime"] === "function" &&
    typeof value["handleDaemonUpgrade"] === "function"
  );
});

export async function loadBuiltStartServer(
  path = runtimeFile(".output", "server", "start-server.js"),
): Promise<BuiltStartServer> {
  const imported: unknown = await import(pathToFileURL(path).href);
  return BuiltStartServerSchema.parse(imported);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
