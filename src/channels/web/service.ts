import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { AgentService } from "../../agents/agent-service.ts";
import type { LoadedConfig } from "../../config/load-config.ts";
import type { ChannelRuntimeLifecycleEvent, ChannelRuntimeService } from "../channel-plugin.ts";
import { processChannelInteraction } from "../interaction-processing.ts";
import { resolveWebConversationTarget } from "./session-routing.ts";
import {
  postWebText,
  reconcileWebText,
  sendWebDone,
  sendWebError,
  sendWebHistory,
  sendAnnotation,
} from "./transport.ts";
import { resolveChannelAuth } from "../../auth/resolve.ts";
import { readSessionHistory } from "./history-reader.ts";
import { createMcpClient, type McpClient, type McpServerConfig } from "./mcp-client.ts";

export type WebBotConfig = {
  port: number;
  apiKey: string;
  agentId: string;
  ownerId?: string;
  senderName?: string;
  // MCP servers the web UI is allowed to invoke directly.
  // Keys are server names; values are spawn configs.
  mcpServers?: Record<string, McpServerConfig>;
};

type IncomingWsMessage =
  | { type: "message"; text: string; contextId?: string }
  | { type: "get_history"; contextId: string }
  | { type: "invoke_tool"; server: string; tool: string; args?: Record<string, unknown> };

const DEFAULT_MAX_CHARS = 32_000;

// Generic structured annotation extraction.
// Agents can embed [[CHANNEL_EVENT:key:value]] markers; the channel strips them
// from the visible stream and emits typed WS events so any client can handle them.
const CHANNEL_EVENT_RE = /\[\[CHANNEL_EVENT:([^:\]]+):([\s\S]*?)\]\]/gi;

function extractChannelEvents(text: string): {
  text: string;
  events: Array<{ key: string; value: string }>;
} {
  const events: Array<{ key: string; value: string }> = [];
  let stripped = text.replace(CHANNEL_EVENT_RE, (_match, key, value) => {
    events.push({ key: key.trim(), value: value.trim() });
    return "";
  });
  // Strip incomplete marker at end of partial stream
  stripped = stripped.replace(/\[\[CHANNEL_EVENT:[\s\S]*$/, "");
  return { text: stripped.trim(), events };
}

export class WebRuntimeService implements ChannelRuntimeService {
  private server: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  // Persistent MCP client connections, one per configured server
  private mcpClients = new Map<string, McpClient>();

  constructor(
    private readonly loadedConfig: LoadedConfig,
    private readonly agentService: AgentService,
    private readonly botConfig: WebBotConfig,
    private readonly reportLifecycle: (event: ChannelRuntimeLifecycleEvent) => Promise<void>,
  ) {}

  private getMcpClient(serverName: string): McpClient | null {
    if (this.mcpClients.has(serverName)) return this.mcpClients.get(serverName)!;
    const config = this.botConfig.mcpServers?.[serverName];
    if (!config) return null;
    const client = createMcpClient(config);
    this.mcpClients.set(serverName, client);
    return client;
  }

  async start() {
    const { port, apiKey, agentId } = this.botConfig;
    const agentService = this.agentService;
    const loadedConfig = this.loadedConfig;

    // In-memory OG image cache: url → {image, ts}
    const ogCache = new Map<string, { image: string | null; ts: number }>();
    const OG_CACHE_TTL = 3600_000; // 1h

    const httpServer = createServer(async (req, res) => {
      // OG image proxy — returns {"image":"..."} or {"image":null}
      if (req.method === "GET" && req.url?.startsWith("/og?")) {
        const targetUrl = new URL(req.url, "http://localhost").searchParams.get("url");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json");
        if (!targetUrl) { res.writeHead(400); res.end('{"image":null}'); return; }

        const cached = ogCache.get(targetUrl);
        if (cached && Date.now() - cached.ts < OG_CACHE_TTL) {
          res.writeHead(200);
          res.end(JSON.stringify({ image: cached.image }));
          return;
        }

        try {
          const html = await fetch(targetUrl, {
            signal: AbortSignal.timeout(5000),
            headers: { "User-Agent": "Mozilla/5.0 (compatible; clisbot/1.0)" },
          }).then(r => r.text());
          const match = html.match(/<meta[^>]+(?:property=["']og:image["']|name=["']og:image["'])[^>]+content=["']([^"']+)["']/i)
            ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property=["']og:image["']|name=["']og:image["'])/i);
          const image = match?.[1] ?? null;
          ogCache.set(targetUrl, { image, ts: Date.now() });
          res.writeHead(200);
          res.end(JSON.stringify({ image }));
        } catch {
          ogCache.set(targetUrl, { image: null, ts: Date.now() });
          res.writeHead(200);
          res.end('{"image":null}');
        }
        return;
      }

      res.writeHead(426, { "Content-Type": "text/plain" });
      res.end("Upgrade required");
    });

    const wss = new WebSocketServer({ noServer: true });

    httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
      const url = new URL(req.url ?? "/", `http://localhost`);
      const key = url.searchParams.get("key");
      if (key !== apiKey) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    });

    wss.on("connection", (ws: WebSocket) => {
      ws.send(JSON.stringify({ type: "ready" }));

      ws.on("message", async (raw) => {
        let msg: IncomingWsMessage;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          sendWebError(ws, "Invalid JSON");
          return;
        }

        // ── History request ──────────────────────────────────────────────────
        if (msg.type === "get_history") {
          const target = resolveWebConversationTarget({
            loadedConfig,
            agentId,
            contextId: msg.contextId,
          });

          const sessionEntry = await agentService.sessionState.getEntry(target.sessionKey).catch(() => null);
          if (sessionEntry?.sessionId && sessionEntry.workspacePath) {
            const history = await readSessionHistory({
              sessionId: sessionEntry.sessionId,
              workspacePath: sessionEntry.workspacePath,
              limit: 60,
            });
            sendWebHistory(ws, msg.contextId, history);
          } else {
            sendWebHistory(ws, msg.contextId, []);
          }
          return;
        }

        // ── MCP tool invocation ──────────────────────────────────────────────
        if (msg.type === "invoke_tool") {
          const client = this.getMcpClient(msg.server);
          if (!client) {
            ws.send(JSON.stringify({
              type: "tool_result", server: msg.server, tool: msg.tool,
              args: msg.args, error: `MCP server '${msg.server}' is not configured`,
            }));
            return;
          }
          try {
            const result = await client.callTool(msg.tool, msg.args ?? {});
            ws.send(JSON.stringify({
              type: "tool_result", server: msg.server, tool: msg.tool,
              args: msg.args, result,
            }));
          } catch (err) {
            ws.send(JSON.stringify({
              type: "tool_result", server: msg.server, tool: msg.tool,
              args: msg.args, error: String(err),
            }));
          }
          return;
        }

        // ── Regular message ──────────────────────────────────────────────────
        if (msg.type !== "message" || !msg.text?.trim()) return;

        const conversationTarget = resolveWebConversationTarget({
          loadedConfig,
          agentId,
          contextId: msg.contextId,
        });

        const identity = {
          platform: "web" as const,
          botId: "default",
          conversationKind: "dm" as const,
          senderId: "web:owner",
          senderName: this.botConfig.senderName ?? "Owner",
        };

        const auth = resolveChannelAuth({
          config: loadedConfig.raw,
          agentId,
          identity,
        });

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
          commandPrefixes: { slash: ["/"], bash: ["!"] },
          streaming: "latest" as const,
          response: "all" as const,
          responseMode: "capture-pane" as const,
          additionalMessageMode: "queue" as const,
          surfaceNotifications: { loopStart: "off" as const, loopEnd: "off" as const },
          verbose: "off" as const,
          followUp: { mode: "disabled" as const },
        };

        let accumulatedText = "";
        let activeChunks: { id: string; text: string }[] = [];

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
            postText: async (text) => {
              accumulatedText = text;
              const { text: cleanText } = extractChannelEvents(text);
              if (activeChunks.length === 0) {
                activeChunks = await postWebText(ws, cleanText);
              } else {
                activeChunks = await reconcileWebText(ws, activeChunks, cleanText);
              }
              return activeChunks;
            },
            reconcileText: async (_chunks, text) => {
              accumulatedText = text;
              const { text: cleanText } = extractChannelEvents(text);
              if (activeChunks.length === 0) {
                activeChunks = await postWebText(ws, cleanText);
              } else {
                activeChunks = await reconcileWebText(ws, activeChunks, cleanText);
              }
              return activeChunks;
            },
          });

          const { events } = extractChannelEvents(accumulatedText);
          for (const event of events) {
            sendAnnotation(ws, msg.contextId, event.key, event.value);
          }

          sendWebDone(ws);
        } catch (err) {
          console.error("[web-channel] interaction error", err);
          sendWebError(ws, "Agent error");
          sendWebDone(ws);
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.listen(port, "0.0.0.0", () => resolve());
      httpServer.once("error", reject);
    });

    // Pre-warm MCP connections so the first user request isn't slow
    for (const serverName of Object.keys(this.botConfig.mcpServers ?? {})) {
      const client = this.getMcpClient(serverName);
      client?.callTool("get_all_reminders", {}).catch(() => { /* ignore warmup errors */ });
    }

    this.server = httpServer;
    this.wss = wss;

    await this.reportLifecycle({
      connection: "active",
      summary: `Web channel WebSocket server active.`,
    });

    console.log(`[web-channel] WebSocket server started on ws://localhost:${port}`);
  }

  async stop() {
    for (const client of this.mcpClients.values()) client.close();
    this.mcpClients.clear();
    this.wss?.close();
    this.server?.close();
    this.wss = null;
    this.server = null;
  }
}
