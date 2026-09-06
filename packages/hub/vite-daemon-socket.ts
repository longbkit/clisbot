import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { isRunnableDevEnvironment, type Plugin, type ViteDevServer } from "vite";

interface DaemonSocketModule {
  handleDaemonUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void>;
}

/** Own only daemon upgrades; Vite and other plugins retain their own sockets. */
export function attachDaemonSocketUpgrade(
  server: NonNullable<ViteDevServer["httpServer"]>,
  loadServer: () => Promise<DaemonSocketModule>,
  reportError: (error: unknown) => void,
): () => void {
  const sockets = new Set<Duplex>();
  let disposed = false;
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (request.url?.split("?", 1)[0] !== "/api/daemons/socket") return;
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    const socketError = (error: Error) => {
      socket.destroy();
      reportError(error);
    };
    socket.once("error", socketError);
    void (async () => {
      try {
        const entry = await loadServer();
        if (disposed || socket.destroyed) return;
        await entry.handleDaemonUpgrade(request, socket, head);
      } catch (error) {
        socket.destroy();
        reportError(error);
      } finally {
        socket.off("error", socketError);
      }
    })();
  };
  const dispose = () => {
    disposed = true;
    server.off("upgrade", upgrade);
    server.off("close", dispose);
    for (const socket of sockets) socket.destroy();
    sockets.clear();
  };
  server.on("upgrade", upgrade);
  server.once("close", dispose);
  return dispose;
}

export function daemonSocketDevelopmentPlugin(): Plugin {
  let dispose: (() => void) | undefined;
  return {
    name: "paseo-hub:daemon-socket",
    apply: "serve",
    configureServer(server) {
      if (server.httpServer === null) return;
      dispose = attachDaemonSocketUpgrade(
        server.httpServer,
        async () => {
          const environment = server.environments["ssr"];
          if (environment === undefined || !isRunnableDevEnvironment(environment)) {
            throw new Error("Hub daemon sockets require the TanStack SSR environment");
          }
          // Match TanStack Start's HTTP dev middleware exactly. Importing the
          // source from Vite's Node process would create a second Hub/DB owner.
          return environment.runner.import<DaemonSocketModule>(
            "virtual:tanstack-start-server-entry",
          );
        },
        (error) => {
          const message = error instanceof Error ? error.message : "Unknown upgrade failure";
          server.config.logger.error(`[paseo-hub:daemon-socket] ${message}`);
        },
      );
    },
    closeBundle() {
      dispose?.();
      dispose = undefined;
    },
  };
}
