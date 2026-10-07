import type express from "express";
import type { Logger } from "pino";
import { CallScreen, SERVER_UNAVAILABLE, type CallContext } from "./connector-call-screen.js";
import { isRecord } from "./connector-json.js";
import {
  connectorInstructions,
  failure,
  initializeResult,
  jsonRpcId,
  refusalResult,
  RELAYED_METHODS,
  rpcError,
  targetOpen,
  toolFilter,
  type RelayTarget,
} from "./connector-relay-frames.js";
import {
  CONNECTORS_RELAY_ROUTE,
  type AgentTicket,
  type ConnectorRuntime,
} from "./connector-runtime.js";
import type { StdioServers } from "./connector-stdio.js";
import {
  createUpstreamSessions,
  DEFAULT_PROTOCOL_VERSION,
  type JsonRpcFrame,
  type UpstreamTarget,
} from "./connector-upstream.js";
import {
  COMPOSIO_META_TOOLS,
  composioMetaTool,
  filterToolsListResult,
} from "./connector-verdict.js";
import { withTimeout } from "../../utils/promise-timeout.js";

/**
 * The daemon side of an agent's Connector MCP servers (docs/features/connectors/README.md,
 * "Runtime"). An agent talks MCP to `/mcp/connectors/composio` or `/mcp/connectors/server/:name`
 * with its capability token. The relay serves only `initialize`, `ping`, `tools/list` and
 * `tools/call`, reaches an upstream only for a target the session's grant has on, checks each call
 * (`CallScreen`), adds the stored credential and forwards. The agent never holds the Composio key
 * or a server's headers.
 */

/** How long the agent's `initialize` waits for the upstream before the relay answers anyway. */
const INITIALIZE_WAIT_MS = 1_500;

export class ConnectorRelay {
  private readonly logger: Logger;
  private readonly sessions = createUpstreamSessions();
  private readonly screen: CallScreen;

  constructor(
    private readonly runtime: ConnectorRuntime,
    private readonly stdio: StdioServers,
    logger: Logger,
  ) {
    this.logger = logger.child({ module: "connectors-relay" });
    this.screen = new CallScreen(
      runtime,
      (target, ticket) => this.upstreamFor(target, ticket),
      this.logger,
    );
  }

  mount(app: express.Express): void {
    const composio = this.route(() => ({ kind: "composio" }));
    const server = this.route((req) => ({ kind: "server", name: String(req.params.name ?? "") }));
    for (const method of ["post", "get", "delete"] as const) {
      app[method](`${CONNECTORS_RELAY_ROUTE}/composio`, composio);
      app[method](`${CONNECTORS_RELAY_ROUTE}/server/:name`, server);
    }
  }

  private route(targetOf: (req: express.Request) => RelayTarget): express.RequestHandler {
    return (req, res) => {
      void this.handle(targetOf(req), req, res).catch((error: unknown) => {
        this.logger.warn({ err: error }, "Connector relay request failed");
        if (!res.headersSent) {
          const message = error instanceof Error ? error.message : "Connector unavailable";
          res.status(200).json(failure(isRecord(req.body) ? req.body : {}, message));
        }
      });
    };
  }

  private async handle(
    target: RelayTarget,
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const ticket = this.runtime.ticketFor(req.header("authorization"));
    if (!ticket) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (req.method !== "POST" || !isRecord(req.body)) {
      const post = req.method === "POST";
      res.status(post ? 400 : 405).json({
        jsonrpc: "2.0",
        error: {
          code: post ? -32600 : -32000,
          message: post ? "Send one JSON-RPC message" : "Method not allowed",
        },
        id: null,
      });
      return;
    }
    let gone = false;
    res.on("close", () => {
      if (!res.writableEnded) gone = true;
    });
    const answer = await this.answerFrame(req.body, { target, ticket, gone: () => gone });
    if (answer === null) res.status(202).end();
    else res.status(200).json(answer);
  }

  /** The answer to one frame, or null for a notification. Never throws. */
  private async answerFrame(frame: JsonRpcFrame, call: CallContext): Promise<JsonRpcFrame | null> {
    if (frame.id === undefined) {
      await this.notify(frame, call);
      return null;
    }
    const method = typeof frame.method === "string" ? frame.method : "";
    if (!RELAYED_METHODS.has(method))
      return rpcError(frame, -32601, `${method || "That method"} is not offered here.`);
    try {
      if (method === "initialize") return await this.initialize(frame, call);
      if (method === "ping") return { jsonrpc: "2.0", id: jsonRpcId(frame), result: {} };
      if (method === "tools/list") return await this.listTools(frame, call);
      return await this.callTool(frame, call);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The connector is unavailable.";
      this.logger.warn(
        { err: error, target: call.target, method },
        "Connector relay request failed",
      );
      return failure(frame, message);
    }
  }

  /**
   * Passes a notification (a cancel, say) to an open target; the relay sends its own
   * `initialized`. A frame without an id that is not a notification is dropped: a `tools/call`
   * sent as one would otherwise reach the upstream without the grant check.
   */
  private async notify(frame: JsonRpcFrame, call: CallContext): Promise<void> {
    const method = typeof frame.method === "string" ? frame.method : "";
    if (!method.startsWith("notifications/") || method === "notifications/initialized") return;
    if (!targetOpen(call.target, await this.runtime.projectGrantFor(call.ticket))) return;
    const upstream = await this.upstreamFor(call.target, call.ticket).catch(() => null);
    if (upstream) this.sessions.notify(call.ticket.agentId, upstream, frame);
  }

  /**
   * Answered here so the agent's MCP client mounts the server even while the upstream is slow
   * or down; the upstream session opens in the background (only for a target the Project has on)
   * and later calls wait for it.
   */
  private async initialize(frame: JsonRpcFrame, call: CallContext): Promise<JsonRpcFrame> {
    if (targetOpen(call.target, await this.runtime.projectGrantFor(call.ticket))) {
      const requested = isRecord(frame.params) ? frame.params.protocolVersion : undefined;
      const version = typeof requested === "string" ? requested : DEFAULT_PROTOCOL_VERSION;
      const opening = this.upstreamFor(call.target, call.ticket)
        .then((upstream) => upstream && this.sessions.open(call.ticket.agentId, upstream, version))
        .catch(() => undefined);
      await withTimeout(opening, INITIALIZE_WAIT_MS, "upstream still opening").catch(
        () => undefined,
      );
    }
    const grant = await this.runtime.grantFor(call.ticket);
    return initializeResult(frame, connectorInstructions(call.target, grant));
  }

  /**
   * The tools of a target the Project has on, even ones this session turned off: an MCP client
   * reads the list once, so a tool hidden now could not be used after the session turns it back
   * on. Calls are where the session's off list applies.
   */
  private async listTools(frame: JsonRpcFrame, call: CallContext): Promise<JsonRpcFrame> {
    const grant = await this.runtime.projectGrantFor(call.ticket);
    if (!targetOpen(call.target, grant)) {
      return { jsonrpc: "2.0", id: jsonRpcId(frame), result: { tools: [] } };
    }
    const answer = await this.sessions.request(
      call.ticket.agentId,
      await this.requireUpstream(call),
      frame,
    );
    if (!isRecord(answer.result)) return answer;
    return {
      ...answer,
      result: filterToolsListResult(
        answer.result,
        toolFilter(call.target, grant, await this.runtime.sessionAllows(call.ticket)),
      ),
    };
  }

  private async callTool(frame: JsonRpcFrame, call: CallContext): Promise<JsonRpcFrame> {
    if (!(await this.callReachable(frame, call))) {
      return refusalResult(
        frame,
        "Nothing on this connector is on for this session; the call was not performed.",
      );
    }
    const decision = await this.screen.screen(frame, call);
    if (decision.kind === "refuse") return refusalResult(frame, decision.message);
    if (decision.kind === "answer") return decision.frame;
    return this.sessions.request(call.ticket.agentId, decision.upstream, decision.frame);
  }

  /**
   * A server must be on for the session before any call to it. Composio's search and schema
   * meta-tools need some app on; an app tool goes to the screen, which may ask to add the app.
   */
  private async callReachable(frame: JsonRpcFrame, call: CallContext): Promise<boolean> {
    const grant = await this.runtime.grantFor(call.ticket);
    if (targetOpen(call.target, grant)) return true;
    if (call.target.kind === "server") return false;
    const name = isRecord(frame.params) ? frame.params.name : undefined;
    const meta = typeof name === "string" ? composioMetaTool(name) : "unknown";
    return meta === null || (meta !== "unknown" && !COMPOSIO_META_TOOLS[meta].needsAppOn);
  }

  private async requireUpstream(call: CallContext): Promise<UpstreamTarget> {
    const upstream = await this.upstreamFor(call.target, call.ticket);
    if (upstream) return upstream;
    throw new Error(SERVER_UNAVAILABLE);
  }

  private async upstreamFor(
    target: RelayTarget,
    ticket: AgentTicket,
  ): Promise<UpstreamTarget | null> {
    if (target.kind === "composio") {
      const { client, session } = await this.runtime.service.composioSession();
      const url = session.mcp.url;
      return {
        key: `composio:${url}`,
        label: "Composio",
        post: ({ body, headers, signal }) => client.postMcp({ url, body, headers, signal }),
      };
    }
    const stored = await this.runtime.service.store.mcpServer(target.name);
    if (!stored || stored.record.enabled === false) return null;
    if (stored.record.transport === "stdio") {
      const cwd = await this.runtime.projectHome(ticket.projectId);
      return this.stdio.target({
        name: target.name,
        owner: ticket.projectId,
        spec: {
          command: stored.record.command ?? "",
          args: stored.record.args ?? [],
          env: stored.secrets.env,
          ...(cwd ? { cwd } : {}),
        },
      });
    }
    if (!stored.record.url) return null;
    const url = stored.record.url;
    return {
      key: `server:${target.name}:${url}`,
      label: `The MCP server "${target.name}"`,
      post: ({ body, headers, signal }) =>
        fetch(url, {
          method: "POST",
          headers: { ...stored.secrets.headers, ...headers },
          body,
          signal,
        }),
    };
  }
}
