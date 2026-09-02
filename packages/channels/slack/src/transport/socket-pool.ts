import { SocketModeClient } from "@slack/socket-mode";
import type { HostChildLogger } from "@getpaseo/channels-shared";
import {
  runSlackSocketReconnectLoop,
  stopSlackSocketClient,
} from "./socket-reconnect.js";

interface SharedSocket {
  readonly client: SocketModeClient;
  readonly controller: AbortController;
  readonly logger?: HostChildLogger;
  refs: number;
  running?: Promise<void>;
}

export interface SharedSlackSocketLease {
  readonly client: SocketModeClient;
  start(): void;
  wait(signal: AbortSignal): Promise<void>;
  release(): Promise<void>;
}

// Process-local by design: credentials never leave driver memory. A Slack app
// token identifies one Socket Mode connection, while each installation is
// routed by the probed teamId in socket-mode.ts.
const sockets = new Map<string, SharedSocket>();

export function acquireSharedSlackSocket(input: {
  appToken: string;
  logger?: HostChildLogger;
  createClient?: (appToken: string) => SocketModeClient;
}): SharedSlackSocketLease {
  let socket = sockets.get(input.appToken);
  if (socket === undefined) {
    socket = {
      client:
        input.createClient?.(input.appToken) ??
        new SocketModeClient({
          appToken: input.appToken,
          autoReconnectEnabled: true,
          clientPingTimeout: 15000,
        }),
      controller: new AbortController(),
      ...(input.logger === undefined ? {} : { logger: input.logger }),
      refs: 0,
    };
    sockets.set(input.appToken, socket);
  }
  socket.refs += 1;
  let released = false;

  const start = (): void => {
    if (socket.running !== undefined) return;
    socket.running = runSlackSocketReconnectLoop({
      startSession: async (): Promise<void> => {
        await socket.client.start();
      },
      waitDisconnect: (): Promise<{ event: "disconnect" | "abort" }> =>
        waitSocketDisconnect(socket.client, socket.controller.signal),
      signal: socket.controller.signal,
      ...(socket.logger === undefined ? {} : { logger: socket.logger }),
    }).finally(async () => {
      await stopSlackSocketClient(socket.client, socket.logger);
    });
  };

  return {
    client: socket.client,
    start,
    async wait(signal: AbortSignal): Promise<void> {
      start();
      await waitForAbortOrSocketEnd(signal, socket.running!);
    },
    async release(): Promise<void> {
      if (released) return;
      released = true;
      socket.refs -= 1;
      if (socket.refs > 0) return;
      sockets.delete(input.appToken);
      socket.controller.abort();
      try {
        await socket.running;
      } catch {
        // The caller observing wait() owns the transport failure. Teardown is
        // best-effort and must remain idempotent for sibling account exits.
      }
    },
  };
}

function waitForAbortOrSocketEnd(
  signal: AbortSignal,
  running: Promise<void>,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      resolve();
    };
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    void running.then(
      () => {
        cleanup();
        if (signal.aborted) resolve();
        else
          reject(
            new Error(
              "Slack shared Socket Mode connection stopped unexpectedly",
            ),
          );
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function waitSocketDisconnect(
  client: SocketModeClient,
  signal: AbortSignal,
): Promise<{ event: "disconnect" | "abort" }> {
  return new Promise((resolve) => {
    const onDisconnected = (): void => {
      cleanup();
      resolve({ event: "disconnect" });
    };
    const onAbort = (): void => {
      cleanup();
      resolve({ event: "abort" });
    };
    const cleanup = (): void => {
      client.off("disconnected", onDisconnected);
      signal.removeEventListener("abort", onAbort);
    };
    client.on("disconnected", onDisconnected);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
