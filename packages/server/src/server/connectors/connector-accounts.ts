import type { ConnectorGrant } from "@clisbot/protocol/connectors/types";
import { COMPOSIO_MULTI_EXECUTE_TOOL, entryToolSlug, toolkitOfTool } from "./connector-verdict.js";
import { isRecord } from "./connector-json.js";

/**
 * Which connected account a Composio call acts as (docs/features/connectors/README.md,
 * "Accounts"). Composio picks the account from `tools[].account` of a multi-execute call, by id
 * or alias. A session limited to some accounts may only name those; when it may use exactly one,
 * the relay names it, so the agent never has to know the id.
 */

export interface KnownAccount {
  id: string;
  alias?: string;
}

export type AccountPin = { kind: "ok"; frame: unknown } | { kind: "deny"; message: string };

function label(account: KnownAccount): string {
  return account.alias ?? account.id;
}

function resolve(known: readonly KnownAccount[], named: string): KnownAccount | undefined {
  const wanted = named.trim().toLowerCase();
  return known.find(
    (account) => account.id.toLowerCase() === wanted || account.alias?.toLowerCase() === wanted,
  );
}

/** The accounts a session may use for one app, or null when it may use every account. */
function allowedAccounts(
  grant: ConnectorGrant | undefined,
  toolkit: string,
  known: readonly KnownAccount[],
): KnownAccount[] | null {
  const chosen = grant?.apps?.[toolkit]?.accounts;
  if (chosen === undefined || chosen === "all") return null;
  return known.filter((account) => chosen.includes(account.id));
}

function pinEntry(
  entry: Record<string, unknown>,
  allowed: KnownAccount[],
  known: readonly KnownAccount[],
): { entry: Record<string, unknown> } | { message: string } {
  const tool = entryToolSlug(entry) ?? "This entry";
  const options = allowed.map(label).join(", ") || "none connected";
  if (typeof entry.account === "string" && entry.account.trim()) {
    const account = resolve(known, entry.account);
    if (account && allowed.some((candidate) => candidate.id === account.id)) {
      return { entry: { ...entry, account: account.id } };
    }
    return {
      message: `${tool} named the account "${entry.account}", which this session may not use. It may use: ${options}.`,
    };
  }
  if (allowed.length === 1) return { entry: { ...entry, account: allowed[0]!.id } };
  return { message: `${tool} needs an account. Set "account" to one of: ${options}.` };
}

/**
 * Checks the account of every entry in a multi-execute call against the session's grant and pins
 * it where the grant allows one account. Calls to other tools pass unchanged, except a direct
 * app-tool call for an app limited to some accounts, which cannot name an account and is refused.
 */
export function pinComposioAccounts(params: {
  frame: unknown;
  grant: ConnectorGrant | undefined;
  accountsBySlug: ReadonlyMap<string, readonly KnownAccount[]>;
  /** Every app slug Composio knows, so a tool is matched to its own app (`toolkitOfTool`). */
  knownSlugs?: readonly string[];
}): AccountPin {
  const { frame } = params;
  if (!isRecord(frame) || frame.method !== "tools/call" || !isRecord(frame.params)) {
    return { kind: "ok", frame };
  }
  const name = frame.params.name;
  if (name !== COMPOSIO_MULTI_EXECUTE_TOOL) return checkDirectCall(name, frame, params);
  const args = frame.params.arguments;
  // The verdict refuses a call without a `tools` list before it gets here.
  if (!isRecord(args) || !Array.isArray(args.tools)) return { kind: "ok", frame };
  const pinned: unknown[] = [];
  for (const item of args.tools) {
    const result = pinItem(item, params);
    if ("message" in result) {
      return { kind: "deny", message: `${result.message} This call was not performed.` };
    }
    pinned.push(result.entry);
  }
  return {
    kind: "ok",
    frame: { ...frame, params: { ...frame.params, arguments: { ...args, tools: pinned } } },
  };
}

interface PinContext {
  grant: ConnectorGrant | undefined;
  accountsBySlug: ReadonlyMap<string, readonly KnownAccount[]>;
  knownSlugs?: readonly string[];
}

function slugsOf(context: PinContext): string[] {
  return [...(context.knownSlugs ?? []), ...Object.keys(context.grant?.apps ?? {})];
}

function pinItem(item: unknown, context: PinContext): { entry: unknown } | { message: string } {
  const slug = entryToolSlug(item);
  if (!isRecord(item) || slug === null) return { entry: item };
  const toolkit = toolkitOfTool(slug, slugsOf(context));
  if (!toolkit) return { entry: item };
  const known = context.accountsBySlug.get(toolkit) ?? [];
  const allowed = allowedAccounts(context.grant, toolkit, known);
  return allowed === null ? { entry: item } : pinEntry(item, allowed, known);
}

/** A direct app-tool call cannot name an account, so it may only run where any account will do. */
function checkDirectCall(name: unknown, frame: unknown, context: PinContext): AccountPin {
  if (typeof name !== "string" || name.startsWith("COMPOSIO_")) return { kind: "ok", frame };
  const toolkit = toolkitOfTool(name, slugsOf(context));
  const known = toolkit ? (context.accountsBySlug.get(toolkit) ?? []) : [];
  if (!toolkit || allowedAccounts(context.grant, toolkit, known) === null) {
    return { kind: "ok", frame };
  }
  return {
    kind: "deny",
    message: `${name} must run through ${COMPOSIO_MULTI_EXECUTE_TOOL} with an "account", because this session may only use some ${toolkit} accounts.`,
  };
}

/** True when any granted app limits which accounts the session may use. */
export function grantLimitsAccounts(grant: ConnectorGrant | undefined): boolean {
  return Object.values(grant?.apps ?? {}).some(
    (app) => app.accounts !== undefined && app.accounts !== "all",
  );
}
