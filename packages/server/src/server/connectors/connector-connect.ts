import { randomBytes } from "node:crypto";
import {
  CONNECTOR_CARD_METADATA,
  connectorAppTitle,
  type ConnectorCard,
} from "@clisbot/protocol/connectors/types";
import type { AgentPermissionResponse } from "../agent/agent-sdk-types.js";
import type { ConnectorService } from "./connector-service.js";
import type { AgentTicket, ConnectorPermissionHost } from "./connector-runtime.js";
import { isRecord } from "./connector-json.js";

/**
 * The connect card (docs/features/connectors/README.md, "Connect card"). When an agent calls an
 * app the Project has no working account for, or one the Project may not use, the relay holds
 * the call and raises a card in the agent's timeline. The app's card connects the account or
 * changes the Project's grant through the ordinary RPCs, which carry their own permission
 * checks; answering the card only says "keep waiting" or "stop". The call runs once the account
 * is active (the daemon closes the card itself) and fails after ten minutes.
 */

const WAIT_MS = 10 * 60_000;
const POLL_MS = 4_000;
const CONNECTION_READS = /^(list|status|check|get)$/i;

export type ConnectOutcome = { ok: true } | { ok: false; message: string };

export interface ConnectFlowDeps {
  service: ConnectorService;
  host(): ConnectorPermissionHost | null;
  sleep?(ms: number): Promise<void>;
  waitMs?: number;
  pollMs?: number;
}

/**
 * The apps a `COMPOSIO_MANAGE_CONNECTIONS` call asks to connect, or null when the call only
 * reads. Models write `toolkits` as slugs or as objects naming `toolkit` or `name`.
 */
export function connectRequestApps(args: unknown): string[] | null {
  if (!isRecord(args)) return null;
  if (typeof args.action === "string" && CONNECTION_READS.test(args.action)) return null;
  const entries = Array.isArray(args.toolkits) ? args.toolkits : [args.toolkit ?? args.app];
  const slugs = new Set<string>();
  for (const entry of entries) {
    const slug = isRecord(entry) ? (entry.toolkit ?? entry.name) : entry;
    if (typeof slug === "string" && slug.trim()) slugs.add(slug.trim().toLowerCase());
  }
  return [...slugs];
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ConnectorConnectFlow {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly polls: number;
  private readonly pollMs: number;
  /**
   * Cards open now, by agent, kind and app. An agent's MCP client can give up on a held call (Codex
   * after about a minute) and call again; the retry waits on the open card instead of a second one.
   */
  private readonly open = new Map<string, Promise<ConnectOutcome>>();

  constructor(private readonly deps: ConnectFlowDeps) {
    this.sleep = deps.sleep ?? defaultSleep;
    this.pollMs = deps.pollMs ?? POLL_MS;
    this.polls = Math.max(1, Math.ceil((deps.waitMs ?? WAIT_MS) / this.pollMs));
  }

  /**
   * The apps among `slugs` that need an account and have no active one on this Host; an app that
   * runs without sign-in (`noAuth`) never does. `fresh` skips the kept list of accounts.
   */
  async missingAccounts(slugs: readonly string[], fresh = false): Promise<string[]> {
    const noAuth = (await this.deps.service.catalogApps())?.noAuth ?? new Set<string>();
    const needed = slugs.filter((slug) => !noAuth.has(slug));
    if (needed.length === 0) return [];
    const apps = await this.deps.service.accounts(needed, { fresh });
    const ready = new Set(
      apps
        .filter((app) => app.accounts.some((account) => account.status === "ACTIVE"))
        .map((app) => app.slug),
    );
    return needed.filter((slug) => !ready.has(slug));
  }

  /** The app's name and logo from Composio's catalog, or a name made from its slug. */
  async describe(slug: string): Promise<{ appName: string; logo?: string }> {
    try {
      const page = await this.deps.service.catalogPage({ search: slug });
      const item = page.items.find((entry) => entry.slug === slug);
      if (item) return { appName: item.name, ...(item.logo ? { logo: item.logo } : {}) };
    } catch {
      // The name is a nicety; the card still works without the catalog.
    }
    return { appName: connectorAppTitle(slug) };
  }

  /** Holds the call until every app has an active account, the person declines, or time runs out. */
  async awaitAccounts(ticket: AgentTicket, slugs: readonly string[]): Promise<ConnectOutcome> {
    // The card waits on what Composio says now, not on the relay's kept list.
    let missing = await this.missingAccounts(slugs, true);
    for (const slug of missing) {
      const outcome = await this.awaitOne(ticket, slug);
      if (!outcome.ok) return outcome;
    }
    missing = await this.missingAccounts(slugs, true);
    return missing.length === 0
      ? { ok: true }
      : { ok: false, message: `${missing.join(", ")} is still not connected.` };
  }

  private awaitOne(ticket: AgentTicket, slug: string): Promise<ConnectOutcome> {
    return this.shared(`${ticket.agentId}:connect:${slug}`, () => this.connectOne(ticket, slug));
  }

  private shared(key: string, run: () => Promise<ConnectOutcome>): Promise<ConnectOutcome> {
    const existing = this.open.get(key);
    if (existing) return existing;
    const outcome = run().finally(() => this.open.delete(key));
    this.open.set(key, outcome);
    return outcome;
  }

  private async connectOne(ticket: AgentTicket, slug: string): Promise<ConnectOutcome> {
    const { appName, logo } = await this.describe(slug);
    const card: ConnectorCard = {
      action: "connect",
      app: slug,
      appName,
      ...(logo ? { logo } : {}),
      projectId: ticket.projectId,
    };
    const raised = this.raise(ticket, card, {
      title: `Connect ${appName} to continue`,
      description: `${appName} has no connected account on this Host. Someone who manages the Host can connect it in Clisbot → Connectors; the task continues when they do.`,
      actions: [
        { id: "wait", label: "Waiting for sign-in", behavior: "allow", variant: "primary" },
        { id: "stop", label: "Not now", behavior: "deny", variant: "secondary" },
      ],
    });
    if (!raised) {
      return {
        ok: false,
        message: `${appName} is not connected on this Host. Ask the person to connect it in Clisbot → Connectors, then try again.`,
      };
    }
    let outcome: ConnectOutcome = { ok: false, message: `Waiting for ${appName} failed.` };
    try {
      outcome = await this.pollUntilConnected(slug, appName, raised);
      return outcome;
    } finally {
      // Whatever ended the wait, the card closes with it; closing an answered card does nothing.
      await this.close(
        ticket,
        raised.id,
        outcome.ok ? { behavior: "allow" } : { behavior: "deny", message: outcome.message },
      );
    }
  }

  /** Whether the app has an active account now; a failed read counts as not yet. */
  private async connectedNow(slug: string): Promise<boolean> {
    try {
      return (await this.missingAccounts([slug], true)).length === 0;
    } catch {
      return false;
    }
  }

  private async pollUntilConnected(
    slug: string,
    appName: string,
    raised: { id: string; decided: Promise<AgentPermissionResponse> },
  ): Promise<ConnectOutcome> {
    const answered = { declined: false, gone: false };
    raised.decided.then(
      (response) => (answered.declined = response.behavior === "deny"),
      // The agent closed or lost its session while the card was open.
      () => (answered.gone = true),
    );
    for (let poll = 0; poll < this.polls; poll += 1) {
      if (answered.declined) {
        return { ok: false, message: `The person chose not to connect ${appName} now.` };
      }
      if (answered.gone) {
        return { ok: false, message: `The session that asked for ${appName} ended.` };
      }
      if (await this.connectedNow(slug)) return { ok: true };
      await this.sleep(this.pollMs);
    }
    return {
      ok: false,
      message: `${appName} was not connected within ten minutes. Ask the person to connect it in Clisbot → Connectors, then try again.`,
    };
  }

  /**
   * Asks whether the Project may use an app it does not have. The card's Allow changes the
   * Project's grant first (`connectors.project_grant.set`, `daemon.manage`); the caller reads
   * the grant again, so an Allow from someone who could not change it changes nothing.
   */
  askToUse(ticket: AgentTicket, slug: string): Promise<ConnectOutcome> {
    return this.shared(`${ticket.agentId}:grant:${slug}`, () => this.askToUseOnce(ticket, slug));
  }

  private async askToUseOnce(ticket: AgentTicket, slug: string): Promise<ConnectOutcome> {
    const { appName, logo } = await this.describe(slug);
    const raised = this.raise(
      ticket,
      {
        action: "grant",
        app: slug,
        appName,
        ...(logo ? { logo } : {}),
        projectId: ticket.projectId,
      },
      {
        title: `Use ${appName} in this Project?`,
        description: `This agent wants to use ${appName}, which this Project's Connectors do not include. Someone who manages the Host can add it.`,
        actions: [
          { id: "allow", label: `Allow ${appName}`, behavior: "allow", variant: "primary" },
          { id: "deny", label: "Deny", behavior: "deny", variant: "secondary" },
        ],
      },
    );
    if (!raised)
      return { ok: false, message: `${appName} is not one of this Project's Connectors.` };
    const response = await raised.decided.catch(
      (): AgentPermissionResponse => ({ behavior: "deny", message: "The session ended." }),
    );
    return response.behavior === "allow"
      ? { ok: true }
      : { ok: false, message: `The person did not allow ${appName} for this Project.` };
  }

  private raise(
    ticket: AgentTicket,
    card: ConnectorCard,
    text: {
      title: string;
      description: string;
      actions: {
        id: string;
        label: string;
        behavior: "allow" | "deny";
        variant?: "primary" | "secondary";
      }[];
    },
  ): { id: string; decided: Promise<AgentPermissionResponse> } | null {
    const host = this.deps.host();
    if (!host) return null;
    const id = `connector_${card.action}_${randomBytes(6).toString("hex")}`;
    const decided = host.requestDaemonPermission(ticket.agentId, {
      id,
      name: `${card.action}:${card.app}`,
      kind: "tool",
      title: text.title,
      description: text.description,
      input: { app: card.app },
      actions: text.actions,
      metadata: { [CONNECTOR_CARD_METADATA]: card },
    });
    return { id, decided };
  }

  private async close(
    ticket: AgentTicket,
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<void> {
    await this.deps.host()?.resolveDaemonPermission?.(ticket.agentId, requestId, response);
  }
}
