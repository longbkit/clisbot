import type { Logger } from "pino";
import {
  connectorEnabledApps,
  connectorToolOffKey,
  type ConnectorGrant,
} from "@clisbot/protocol/connectors/types";
import { grantLimitsAccounts, pinComposioAccounts } from "./connector-accounts.js";
import { connectRequestApps, type ConnectOutcome } from "./connector-connect.js";
import { isRecord } from "./connector-json.js";
import { refusalResult, textResult, type RelayTarget } from "./connector-relay-frames.js";
import type { AgentTicket, ConnectorRuntime, SendDecision } from "./connector-runtime.js";
import type { JsonRpcFrame, UpstreamTarget } from "./connector-upstream.js";
import {
  composioTargetNames,
  judgeComposioFrame,
  judgeMcpServerFrame,
  toolkitOfTool,
  type ToolHintsLookup,
  type ComposioMetaTool,
  type ConnectorVerdict,
} from "./connector-verdict.js";

/**
 * Whether one `tools/call` runs (docs/features/connectors/README.md, "Runtime"): the grant (with
 * the "use this app?" card), the account (with the connect card), then the send approval. Each
 * card can wait minutes, so after a wait the grant and the upstream are read again, and a call
 * whose agent hung up meanwhile is not sent.
 */

export type ScreenDecision =
  | { kind: "refuse"; message: string }
  | { kind: "answer"; frame: JsonRpcFrame }
  | { kind: "forward"; frame: JsonRpcFrame; upstream: UpstreamTarget };

type Checked =
  | { kind: "refuse"; message: string; missingApps?: string[] }
  | {
      kind: "ok";
      frame: JsonRpcFrame;
      verdict: ConnectorVerdict;
      grant: ConnectorGrant | undefined;
    };

export interface CallContext {
  target: RelayTarget;
  ticket: AgentTicket;
  /** True once the agent's HTTP request is gone; nothing is sent for it after that. */
  gone(): boolean;
}

const MANAGE_CONNECTIONS: ComposioMetaTool = "COMPOSIO_MANAGE_CONNECTIONS";
const WAIT_FOR_CONNECTIONS: ComposioMetaTool = "COMPOSIO_WAIT_FOR_CONNECTIONS";

/** A server target needs no catalog. */
const NO_APPS = {
  slugs: [],
  names: new Map<string, string>(),
  logos: new Map<string, string>(),
  noAuth: new Set<string>(),
};

function turnedOffMessage(tool: string): string {
  return `"${tool}" is turned off for this session. This call was not performed. Ask the person to turn it back on in the session's Tools if it should be allowed.`;
}

const CATALOG_UNAVAILABLE =
  "Clisbot could not read Composio's app list, so it cannot check which app this tool belongs to. The call was not performed; try again in a moment.";

export const SERVER_UNAVAILABLE =
  "The MCP server is turned off or no longer configured on this Host.";

export class CallScreen {
  constructor(
    private readonly runtime: ConnectorRuntime,
    private readonly upstreamFor: (
      target: RelayTarget,
      ticket: AgentTicket,
    ) => Promise<UpstreamTarget | null>,
    private readonly logger: Logger,
  ) {}

  async screen(frame: JsonRpcFrame, call: CallContext): Promise<ScreenDecision> {
    const local = await this.answerConnections(frame, call);
    if (local) return { kind: "answer", frame: local };
    let checked = await this.grantOrAsk(frame, call);
    if (checked.kind === "refuse") return this.refuse(call, checked.message);
    const ready = await this.accountsReady(checked.verdict, call);
    if (!ready.ok) return this.refuse(call, ready.message);
    if (ready.waited) {
      checked = await this.checkGrant(frame, call);
      if (checked.kind === "refuse") return this.refuse(call, checked.message);
    }
    return this.sendStep(frame, checked, call);
  }

  /** The send approval, then what goes upstream: read again after any wait. */
  private async sendStep(
    original: JsonRpcFrame,
    checked: Extract<Checked, { kind: "ok" }>,
    call: CallContext,
  ): Promise<ScreenDecision> {
    let upstream = await this.upstreamFor(call.target, call.ticket);
    if (!upstream) return this.refuse(call, SERVER_UNAVAILABLE);
    const sends = await this.decideSends(checked, call, upstream.label);
    if (!sends.allowed) return this.refuse(call, sends.message);
    let frame = checked.frame;
    if (sends.waited) {
      const again = await this.checkGrant(original, call);
      if (again.kind === "refuse") return this.refuse(call, again.message);
      upstream = await this.upstreamFor(call.target, call.ticket);
      if (!upstream) return this.refuse(call, "The MCP server was turned off while waiting.");
      frame = again.frame;
    }
    if (call.gone()) {
      if (sends.approvalKey) this.runtime.keepApproval(sends.approvalKey);
      return this.refuse(call, "The agent stopped waiting, so the call was not sent.");
    }
    return { kind: "forward", frame, upstream };
  }

  private refuse(call: CallContext, message: string): ScreenDecision {
    const { ticket, target } = call;
    this.logger.info(
      { projectId: ticket.projectId, agentId: ticket.agentId, target, decision: "deny" },
      message,
    );
    return { kind: "refuse", message };
  }

  /**
   * Composio's connection meta-tools, answered here: a read lists only the accounts this session
   * may use, a request to connect raises the connect card, and waiting is the card's job.
   */
  private async answerConnections(
    frame: JsonRpcFrame,
    call: CallContext,
  ): Promise<JsonRpcFrame | null> {
    if (call.target.kind !== "composio" || !isRecord(frame.params)) return null;
    const { name, arguments: args } = frame.params;
    if (name === WAIT_FOR_CONNECTIONS) {
      return textResult(
        frame,
        "Clisbot shows the person a connect card when an app needs one and continues the call itself. Call the app's tool, or COMPOSIO_MANAGE_CONNECTIONS with its toolkit.",
      );
    }
    if (name !== MANAGE_CONNECTIONS) return null;
    const apps = connectRequestApps(args);
    if (apps === null) return this.listConnections(frame, call.ticket);
    if (apps.length === 0) return refusalResult(frame, 'Name the app to connect in "toolkits".');
    return this.connectApps(frame, call.ticket, apps);
  }

  private async listConnections(frame: JsonRpcFrame, ticket: AgentTicket): Promise<JsonRpcFrame> {
    const grant = await this.runtime.grantFor(ticket);
    const apps = connectorEnabledApps(grant);
    const states = apps.length > 0 ? await this.runtime.service.accounts(apps) : [];
    const connections = apps.map((app) => {
      const chosen = grant?.apps?.[app]?.accounts;
      const accounts = (states.find((state) => state.slug === app)?.accounts ?? []).filter(
        (account) => chosen === undefined || chosen === "all" || chosen.includes(account.id),
      );
      return {
        app,
        // An account without a name has `name: undefined`, which JSON leaves out.
        accounts: accounts.map((account) => ({
          id: account.id,
          name: account.alias,
          status: account.status,
        })),
      };
    });
    return textResult(frame, JSON.stringify({ connections }, null, 1));
  }

  private async connectApps(
    frame: JsonRpcFrame,
    ticket: AgentTicket,
    apps: string[],
  ): Promise<JsonRpcFrame> {
    const grant = await this.runtime.grantFor(ticket);
    const paused = apps.find((app) => grant?.apps?.[app]?.enabled === false);
    if (paused) return refusalResult(frame, `${paused} is turned off for this session.`);
    const missing = apps.filter((app) => !grant?.apps?.[app]);
    const asked = await this.askToUse(ticket, missing);
    if (!asked.ok) return refusalResult(frame, asked.message);
    const after = await this.runtime.grantFor(ticket);
    const still = missing.find((app) => !after?.apps?.[app]);
    if (still) return refusalResult(frame, `${still} is not one of this Project's Connectors.`);
    const ready = await this.runtime.connect.awaitAccounts(ticket, apps);
    if (!ready.ok) return refusalResult(frame, ready.message);
    return textResult(
      frame,
      `Connected: ${apps.join(", ")}. Continue the task with COMPOSIO_MULTI_EXECUTE_TOOL.`,
    );
  }

  /** Raises the "use this app?" card for each app in turn; stops at the first one refused. */
  private async askToUse(ticket: AgentTicket, apps: string[]): Promise<ConnectOutcome> {
    for (const app of apps) {
      const asked = await this.runtime.connect.askToUse(ticket, app);
      if (!asked.ok) return asked;
    }
    return { ok: true };
  }

  /** The grant check; apps the Project lacks raise the "use this app?" card, then it runs again. */
  private async grantOrAsk(frame: JsonRpcFrame, call: CallContext): Promise<Checked> {
    const checked = await this.checkGrant(frame, call);
    if (checked.kind !== "refuse" || !checked.missingApps || call.target.kind !== "composio") {
      return checked;
    }
    const asked = await this.askToUse(call.ticket, checked.missingApps);
    if (!asked.ok) return { kind: "refuse", message: asked.message };
    return this.checkGrant(frame, call);
  }

  /** Composio calls wait on the connect card for apps with no active account. */
  private async accountsReady(
    verdict: ConnectorVerdict,
    call: CallContext,
  ): Promise<{ ok: true; waited: boolean } | { ok: false; message: string }> {
    if (call.target.kind !== "composio" || verdict.kind !== "tools")
      return { ok: true, waited: false };
    const apps = [
      ...new Set(verdict.tools.flatMap((tool) => (tool.toolkit ? [tool.toolkit] : []))),
    ];
    const missing = await this.runtime.connect.missingAccounts(apps);
    if (missing.length === 0) return { ok: true, waited: false };
    const outcome = await this.runtime.connect.awaitAccounts(call.ticket, missing);
    return outcome.ok ? { ok: true, waited: true } : outcome;
  }

  private async decideSends(
    checked: Extract<Checked, { kind: "ok" }>,
    call: CallContext,
    serverLabel: string,
  ): Promise<SendDecision> {
    const { verdict, grant } = checked;
    if (verdict.kind !== "tools" || !grant) return { allowed: true };
    const sends = await this.runtime.decideSends({
      ticket: call.ticket,
      grant,
      tools: verdict.tools,
      args: isRecord(checked.frame.params) ? checked.frame.params.arguments : undefined,
      serverLabel,
      ...(call.target.kind === "server" ? { serverName: call.target.name } : {}),
    });
    this.logger.info(
      {
        projectId: call.ticket.projectId,
        agentId: call.ticket.agentId,
        tools: verdict.tools.map((tool) => `${tool.name}:${tool.kind}`),
        decision: sends.allowed ? "allow" : "deny",
      },
      "Connector tool call",
    );
    return sends;
  }

  /** The grant as it is now, judged against this frame; Composio calls get their accounts pinned. */
  private async checkGrant(frame: JsonRpcFrame, call: CallContext): Promise<Checked> {
    const grant = await this.runtime.grantFor(call.ticket);
    const sessionAllows = await this.runtime.sessionAllows(call.ticket);
    const catalog =
      call.target.kind === "composio" ? await this.runtime.service.catalogApps() : NO_APPS;
    const knownSlugs = [...(catalog?.slugs ?? []), ...Object.keys(grant?.apps ?? {})];
    const verdict =
      call.target.kind === "composio"
        ? judgeComposioFrame({
            frame,
            grant,
            knownSlugs,
            hints: await this.toolHints(frame, knownSlugs),
            sessionAllows,
          })
        : judgeMcpServerFrame({ frame, server: call.target.name, grant, sessionAllows });
    // Without the catalog a tool cannot be told apart from a longer-named app's (`zoho` and
    // `zoho_mail`), so app tools wait for it; meta-tools and refusals do not need it.
    const matchedApps =
      verdict.kind === "tools" || (verdict.kind === "deny" && verdict.missingApps !== undefined);
    if (catalog === null && matchedApps) return { kind: "refuse", message: CATALOG_UNAVAILABLE };
    if (verdict.kind === "deny") {
      return {
        kind: "refuse",
        message: verdict.message,
        ...(verdict.missingApps ? { missingApps: verdict.missingApps } : {}),
      };
    }
    const off = await this.toolTurnedOff(verdict, call);
    if (off) return { kind: "refuse", message: turnedOffMessage(off) };
    if (call.target.kind !== "composio") return { kind: "ok", frame, verdict, grant };
    const pinned = await this.pinAccounts(frame, grant, knownSlugs);
    if (pinned.kind === "deny") return { kind: "refuse", message: pinned.message };
    return { kind: "ok", frame: pinned.frame as JsonRpcFrame, verdict, grant };
  }

  /** A tool of the call the session turned off on its own (`gmail/GMAIL_SEND_EMAIL`). */
  private async toolTurnedOff(
    verdict: ConnectorVerdict,
    call: CallContext,
  ): Promise<string | undefined> {
    if (verdict.kind !== "tools") return undefined;
    const off = await this.runtime.sessionOff(call.ticket);
    const target = call.target;
    return verdict.tools.find((tool) => {
      if (target.kind === "server") {
        return off.has(connectorToolOffKey({ mcpServer: target.name }, tool.name));
      }
      // Composio slugs are upper case, but a call may spell one in lower case: off is off.
      const app = tool.toolkit;
      if (app === null) return false;
      return [tool.name, tool.name.toUpperCase()].some((name) =>
        off.has(connectorToolOffKey({ app }, name)),
      );
    })?.name;
  }

  /**
   * What the tools this frame would run say about themselves (a read, a change), read from
   * Composio per app, so a read whose verb comes last (`GOOGLECALENDAR_EVENTS_LIST`) is a read.
   */
  private async toolHints(frame: JsonRpcFrame, knownSlugs: string[]): Promise<ToolHintsLookup> {
    const apps = new Set<string>();
    for (const name of composioTargetNames(frame)) {
      const app = toolkitOfTool(name, knownSlugs);
      if (app) apps.add(app);
    }
    const maps = await Promise.all([...apps].map((app) => this.runtime.service.toolHints(app)));
    return (tool) => maps.find((hints) => hints.has(tool))?.get(tool);
  }

  /** The Host's accounts per app, read only when the session is limited to some of them. */
  private async pinAccounts(
    frame: unknown,
    grant: ConnectorGrant | undefined,
    knownSlugs: string[],
  ) {
    if (!grantLimitsAccounts(grant)) return { kind: "ok" as const, frame };
    const apps = await this.runtime.service.accounts(Object.keys(grant?.apps ?? {}));
    const accountsBySlug = new Map(
      apps.map(
        (app) => [app.slug, app.accounts.filter((account) => account.status === "ACTIVE")] as const,
      ),
    );
    return pinComposioAccounts({ frame, grant, accountsBySlug, knownSlugs });
  }
}
