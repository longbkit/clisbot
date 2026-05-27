import type { AgentService } from "../../agents/agent-service.ts";
import type { LoadedConfig } from "../../config/load-config.ts";
import type { ProcessedEventsStore } from "../processed-events-store.ts";
import type { ActivityStore } from "../../control/activity-store.ts";
import type { ChannelRuntimeLifecycleEvent, ChannelRuntimeService } from "../channel-plugin.ts";
import { processChannelInteraction } from "../interaction-processing.ts";
import { resolveWebConversationTarget } from "./session-routing.ts";
import { postWebText, reconcileWebText, sendWebDone, sendWebError } from "./transport.ts";
import { resolveChannelAuth } from "../../auth/resolve.ts";
import { DEFAULT_PROTECTED_CONTROL_RULE } from "../../auth/defaults.ts";

export type WebBotConfig = {
  port: number;
  apiKey: string;
  agentId: string;
  ownerId?: string;
};

export type WebSocketData = {
  authenticated: boolean;
  todoId?: string;
};

type IncomingMessage = {
  type: "message";
  text: string;
  todoId?: string;
};

const DEFAULT_MAX_CHARS = 32_000;

export class WebRuntimeService implements ChannelRuntimeService {
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(
    private readonly loadedConfig: LoadedConfig,
    private readonly agentService: AgentService,
    private readonly botConfig: WebBotConfig,
    private readonly reportLifecycle: (event: ChannelRuntimeLifecycleEvent) => Promise<void>,
  ) {}

  async start() {
    const { port, apiKey, agentId } = this.botConfig;
    const agentService = this.agentService;
    const loadedConfig = this.loadedConfig;

    this.server = Bun.serve<WebSocketData>({
      port,
      fetch(req, server) {
        const url = new URL(req.url);
        const key = url.searchParams.get("key");
        if (key !== apiKey) {
          return new Response("Unauthorized", { status: 401 });
        }
        const upgraded = server.upgrade(req, {
          data: { authenticated: true },
        });
        if (upgraded) return undefined;
        return new Response("Upgrade required", { status: 426 });
      },
      websocket: {
        open(ws) {
          ws.send(JSON.stringify({ type: "ready" }));
        },
        async message(ws, raw) {
          let msg: IncomingMessage;
          try {
            msg = JSON.parse(String(raw));
          } catch {
            sendWebError(ws, "Invalid JSON");
            return;
          }

          if (msg.type !== "message" || !msg.text?.trim()) return;

          const conversationTarget = resolveWebConversationTarget({
            loadedConfig,
            agentId,
            todoId: msg.todoId,
          });

          const identity = {
            platform: "web" as const,
            botId: "default",
            conversationKind: "dm" as const,
            senderId: "web:owner",
            senderName: "Bobby",
          };

          const auth = resolveChannelAuth({
            config: loadedConfig.raw,
            agentId,
            identity,
          });

          // Grant owner-level access — the API key already authenticated this user.
          const elevatedAuth = {
            ...auth,
            appRole: "owner" as const,
            agentRole: "owner" as const,
            mayBypassPairing: true,
            mayManageProtectedResources: true,
            canUseShell: true,
          };

          const route = {
            agentId,
            requireMention: false,
            allowBots: false,
            commandPrefixes: { slash: "/", at: "@" },
            streaming: "latest" as const,
            response: "all" as const,
            responseMode: "message-tool" as const,
            additionalMessageMode: "queue" as const,
            surfaceNotifications: { loopStart: "off" as const, loopEnd: "off" as const },
            verbose: "off" as const,
            followUp: { mode: "disabled" as const },
          };

          try {
            await processChannelInteraction({
              agentService,
              sessionTarget: conversationTarget,
              identity,
              auth: elevatedAuth,
              senderId: "web:owner",
              text: msg.text,
              route,
              maxChars: DEFAULT_MAX_CHARS,
              postText: (text) => postWebText(ws, text),
              reconcileText: (chunks, text) => reconcileWebText(ws, chunks, text),
            });
            sendWebDone(ws);
          } catch (err) {
            console.error("[web-channel] interaction error", err);
            sendWebError(ws, "Agent error");
            sendWebDone(ws);
          }
        },
        close(ws) {
          // nothing to clean up per-connection
        },
      },
    });

    await this.reportLifecycle({
      connection: "active",
      summary: `Web channel listening on port ${port}`,
    });

    console.log(`[web-channel] WebSocket server started on ws://localhost:${port}`);
  }

  async stop() {
    this.server?.stop(true);
    this.server = null;
  }
}
