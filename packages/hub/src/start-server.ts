import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  handleDaemonUpgrade as handleProductionDaemonUpgrade,
  startProductionRuntime as startHubProductionRuntime,
  stopProductionRuntime,
} from "./index.js";
import { hasApplication, startApplication } from "./server/runtime.js";
export { startApplication } from "./server/runtime.js";

const startFetch = createStartHandler(defaultStreamHandler);

export function startProductionRuntime() {
  return startHubProductionRuntime();
}

export function handleDaemonUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
  return handleProductionDaemonUpgrade(request, socket, head);
}

export { stopProductionRuntime };

const fetch = async (request: Request) => {
  if (!hasApplication()) await startProductionRuntime();
  return startFetch(request);
};

export default { fetch };
