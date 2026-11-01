import type { Page } from "@playwright/test";
import { daemonWsRoutePattern } from "./daemon-port";

/** Answers every `list_commands` request with these commands, forwarding everything else. */
export async function installListCommandsResponse(
  page: Page,
  commands: readonly { name: string; description: string; argumentHint: string }[],
): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();

    ws.onMessage((message) => {
      server.send(message);
    });

    server.onMessage((message) => {
      if (typeof message !== "string") {
        ws.send(message);
        return;
      }

      try {
        const parsed = JSON.parse(message) as {
          type?: string;
          message?: {
            type?: string;
            payload?: {
              commands?: unknown;
              error?: string | null;
            };
          };
        };
        if (
          parsed.type === "session" &&
          parsed.message?.type === "list_commands_response" &&
          parsed.message.payload
        ) {
          parsed.message.payload.commands = commands;
          parsed.message.payload.error = null;
          ws.send(JSON.stringify(parsed));
          return;
        }
      } catch {
        // Forward non-JSON frames unchanged.
      }

      ws.send(message);
    });
  });
}
