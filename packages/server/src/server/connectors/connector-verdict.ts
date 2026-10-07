import {
  connectorAccessOf,
  connectorToolOffKey,
  type ConnectorGrant,
  type ConnectorToolKind,
} from "@clisbot/protocol/connectors/types";
import { connectorCallKind, type ConnectorToolHints } from "./connector-tool-kind.js";
import { isRecord } from "./connector-json.js";

/**
 * The relay's decision for one JSON-RPC frame an agent sends to Composio
 * (docs/features/connectors/README.md, "Runtime"). Composio's session exposes meta-tools:
 * the agent searches, then runs app tools through `COMPOSIO_MULTI_EXECUTE_TOOL`, so the
 * verdict reads the target tools out of that call. A call whose targets cannot be read is
 * refused: the grant promises "exactly these tools", even to a model that garbles a call.
 */

/**
 * The Composio meta-tools agents may see, and what Clisbot does with each. Every other
 * `COMPOSIO_*` name is hidden and refused: some run code or raw HTTP against connected accounts
 * past any grant (workbench, bash, proxy execute), and a meta-tool Composio adds later cannot be
 * judged until it is added here.
 * - `preapproved`: no agent prompt for it; the relay is the gate.
 * - `needsAppOn`: only while some app is on for the session (searching and schemas).
 * - `answeredByRelay`: Clisbot answers it itself and never forwards it (`connector-call-screen.ts`).
 */
export const COMPOSIO_META_TOOLS = {
  COMPOSIO_SEARCH_TOOLS: { preapproved: true, needsAppOn: true, answeredByRelay: false },
  COMPOSIO_GET_TOOL_SCHEMAS: { preapproved: true, needsAppOn: true, answeredByRelay: false },
  COMPOSIO_MULTI_EXECUTE_TOOL: { preapproved: true, needsAppOn: false, answeredByRelay: false },
  COMPOSIO_MANAGE_CONNECTIONS: { preapproved: true, needsAppOn: false, answeredByRelay: true },
  COMPOSIO_WAIT_FOR_CONNECTIONS: { preapproved: false, needsAppOn: false, answeredByRelay: true },
} as const;
export type ComposioMetaTool = keyof typeof COMPOSIO_META_TOOLS;

export const COMPOSIO_MULTI_EXECUTE_TOOL: ComposioMetaTool = "COMPOSIO_MULTI_EXECUTE_TOOL";

export const PREAPPROVED_COMPOSIO_TOOLS = (
  Object.keys(COMPOSIO_META_TOOLS) as ComposioMetaTool[]
).filter((name) => COMPOSIO_META_TOOLS[name].preapproved);

/** A known meta-tool, `unknown` for any other `COMPOSIO_*` name, or null for an app tool. */
export function composioMetaTool(name: string): ComposioMetaTool | "unknown" | null {
  if (!name.toUpperCase().startsWith("COMPOSIO_")) return null;
  return Object.hasOwn(COMPOSIO_META_TOOLS, name) ? (name as ComposioMetaTool) : "unknown";
}

/** Whether the relay shows a Composio tool to agents at all: app tools yes, meta-tools if known. */
export function isOfferedComposioTool(name: string): boolean {
  return composioMetaTool(name) !== "unknown";
}

/**
 * The tool a multi-execute entry runs. Composio documents `tool_slug`; models also write
 * `slug`, `tool` or `name`, and Composio accepts some of these, so the grant reads them all and
 * refuses an entry that names two different tools.
 */
const ENTRY_TOOL_KEYS = ["tool_slug", "slug", "tool", "name"] as const;

export function entryToolSlug(entry: unknown): string | null {
  if (!isRecord(entry)) return null;
  const named = new Set<string>();
  for (const key of ENTRY_TOOL_KEYS) {
    const value = entry[key];
    if (typeof value === "string" && value.trim()) named.add(value.trim());
  }
  return named.size === 1 ? [...named][0]! : null;
}

export interface ConnectorTargetTool {
  name: string;
  toolkit: string | null;
  kind: ConnectorToolKind;
}

export type ConnectorVerdict =
  | { kind: "pass" }
  | {
      kind: "deny";
      message: string;
      /** The apps the call needs that the grant does not name; the relay may ask to add them. */
      missingApps?: string[];
    }
  | { kind: "tools"; tools: ConnectorTargetTool[] };

interface JsonRpcCall {
  name: string;
  args: unknown;
}

function readToolCall(frame: unknown): JsonRpcCall | "malformed" | null {
  if (!isRecord(frame) || frame.method !== "tools/call") return null;
  if (!isRecord(frame.params)) return "malformed";
  const name = frame.params.name;
  if (typeof name !== "string" || !name) return "malformed";
  return { name, args: frame.params.arguments };
}

/**
 * The target tool names of a multi-execute call, or null when the shape is unreadable. Composio
 * requires the `tools` list (a tool named at the top level is refused there too, checked live on
 * 2026-10-06), so nothing else is read as a target.
 */
function multiExecuteTargets(args: unknown): TargetCall[] | null {
  if (!isRecord(args) || !Array.isArray(args.tools) || args.tools.length === 0) return null;
  const targets: TargetCall[] = [];
  for (const entry of args.tools) {
    const name = entryToolSlug(entry);
    if (name === null) return null;
    targets.push({ name, args: isRecord(entry) ? entry.arguments : undefined });
  }
  return targets;
}

/** One app tool a frame would run, with the arguments it would run with. */
interface TargetCall {
  name: string;
  args: unknown;
}

/** What each tool says about itself, by name (`ConnectorService.toolHints`). */
export type ToolHintsLookup = (tool: string) => ConnectorToolHints | undefined;

/** The app tools a frame to Composio would run, so their hints can be read before judging it. */
export function composioTargetNames(frame: unknown): string[] {
  const call = readToolCall(frame);
  if (call === null || call === "malformed") return [];
  if (call.name === COMPOSIO_MULTI_EXECUTE_TOOL) {
    return (multiExecuteTargets(call.args) ?? []).map((target) => target.name);
  }
  return composioMetaTool(call.name) === null ? [call.name] : [];
}

/** The app a Composio tool belongs to: the longest known slug prefix, else the first word. */
export function toolkitOfTool(tool: string, knownSlugs: readonly string[]): string | null {
  let match: string | null = null;
  for (const slug of knownSlugs) {
    if (tool.toUpperCase().startsWith(`${slug.toUpperCase()}_`)) {
      if (match === null || slug.length > match.length) match = slug;
    }
  }
  if (match) return match;
  // A slug can start with "_" (`_1password`), so the first word starts after any leading ones.
  const lead = tool.length - tool.replace(/^_+/, "").length;
  const underscore = tool.indexOf("_", lead);
  return underscore > lead ? tool.slice(0, underscore).toLowerCase() : null;
}

function refusal(names: string[], reason: string): Extract<ConnectorVerdict, { kind: "deny" }> {
  const quoted = names.map((name) => `"${name}"`).join(", ");
  return {
    kind: "deny",
    message: `${quoted} ${reason} This call was not performed. Ask the person to change the Project's Connectors if it should be allowed.`,
  };
}

/** What a frame is judged against: the session's grant and the tools it may use beyond it. */
interface JudgeContext {
  grant: ConnectorGrant | undefined;
  knownSlugs: readonly string[];
  hints?: ToolHintsLookup;
  /** Tools this one session may use beyond the grant (`gmail/GMAIL_SEND_EMAIL`), by its key. */
  sessionAllows?: ReadonlySet<string>;
}

type AppGrantEntry = NonNullable<ConnectorGrant["apps"]>[string];

/** One tool of an app the grant names: refused, or what it is. */
function judgeAppTool(
  call: TargetCall,
  app: { toolkit: string; grant: AppGrantEntry },
  context: JudgeContext,
): { tool: ConnectorTargetTool } | { deny: Extract<ConnectorVerdict, { kind: "deny" }> } {
  const { name, args } = call;
  if (app.grant.enabled === false) {
    return { deny: refusal([name], "belongs to an app that is turned off for this session.") };
  }
  const allowedHere =
    context.sessionAllows?.has(connectorToolOffKey({ app: app.toolkit }, name)) ?? false;
  if (!allowedHere && app.grant.tools !== "all" && !app.grant.tools.includes(name)) {
    return { deny: refusal([name], "is not one of the tools this session may use.") };
  }
  const kind = connectorCallKind(
    { name, toolkit: app.toolkit, hints: context.hints?.(name) },
    args,
  );
  if (!allowedHere && kind !== "read" && connectorAccessOf(app.grant.access) === "read") {
    return { deny: refusal([name], "changes data, and this session may only read from that app.") };
  }
  return { tool: { name, toolkit: app.toolkit, kind } };
}

function judgeTargets(targets: TargetCall[], context: JudgeContext): ConnectorVerdict {
  const apps = context.grant?.apps ?? {};
  const slugs = [...context.knownSlugs, ...Object.keys(apps)];
  // One entry per call, repeats included: the send card and the daily count see each send.
  const tools: ConnectorTargetTool[] = [];
  const missing = new Map<string, string>();
  for (const call of targets) {
    const toolkit = toolkitOfTool(call.name, slugs);
    const appGrant = toolkit !== null && Object.hasOwn(apps, toolkit) ? apps[toolkit] : undefined;
    if (toolkit === null) {
      return refusal([call.name], "belongs to an app this session may not use.");
    }
    if (!appGrant) {
      missing.set(toolkit, call.name);
      continue;
    }
    const judged = judgeAppTool(call, { toolkit, grant: appGrant }, context);
    if ("deny" in judged) return judged.deny;
    tools.push(judged.tool);
  }
  if (missing.size > 0) {
    const refused = refusal([...missing.values()], "belongs to an app this session may not use.");
    return { ...refused, missingApps: [...missing.keys()] };
  }
  return { kind: "tools", tools };
}

/** Judge one frame sent to the Composio session against a session's grant. */
export function judgeComposioFrame(params: JudgeContext & { frame: unknown }): ConnectorVerdict {
  const call = readToolCall(params.frame);
  if (call === null) return { kind: "pass" };
  if (call === "malformed") {
    return {
      kind: "deny",
      message: "A tools/call arrived without a tool name; it was not performed.",
    };
  }
  if (call.name === COMPOSIO_MULTI_EXECUTE_TOOL) {
    const targets = multiExecuteTargets(call.args);
    if (!targets) {
      return {
        kind: "deny",
        message: `${COMPOSIO_MULTI_EXECUTE_TOOL} named no readable tool (each entry needs one "tool_slug"), so it was not performed.`,
      };
    }
    return judgeTargets(targets, params);
  }
  const meta = composioMetaTool(call.name);
  if (meta === "unknown") {
    return refusal(
      [call.name],
      "is a Composio tool Clisbot does not offer: it could run code or raw requests against connected accounts past this session's grant.",
    );
  }
  if (meta !== null) {
    // Connection tools are answered by the relay; one reaching the verdict is never forwarded.
    if (COMPOSIO_META_TOOLS[meta].answeredByRelay) {
      return refusal([call.name], "is answered by Clisbot, not by Composio.");
    }
    return { kind: "pass" };
  }
  return judgeTargets([{ name: call.name, args: call.args }], params);
}

/** Judge one frame sent to a remote MCP server: the grant names the server and its tools. */
export function judgeMcpServerFrame(params: {
  frame: unknown;
  server: string;
  grant: ConnectorGrant | undefined;
  sessionAllows?: ReadonlySet<string>;
}): ConnectorVerdict {
  const call = readToolCall(params.frame);
  if (call === null) return { kind: "pass" };
  if (call === "malformed") {
    return {
      kind: "deny",
      message: "A tools/call arrived without a tool name; it was not performed.",
    };
  }
  const serverGrant = params.grant?.mcpServers?.[params.server];
  if (!serverGrant)
    return refusal(
      [call.name],
      `is on the MCP server "${params.server}", which this session may not use.`,
    );
  if (serverGrant.enabled === false) {
    return refusal(
      [call.name],
      `is on the MCP server "${params.server}", which is turned off for this session.`,
    );
  }
  const allowedHere =
    params.sessionAllows?.has(connectorToolOffKey({ mcpServer: params.server }, call.name)) ??
    false;
  if (!allowedHere && serverGrant.tools !== "all" && !serverGrant.tools.includes(call.name)) {
    return refusal([call.name], "is not one of the tools this session may use.");
  }
  return {
    kind: "tools",
    tools: [
      { name: call.name, toolkit: null, kind: connectorCallKind({ name: call.name }, call.args) },
    ],
  };
}

/** Keep only the tools a grant allows in a `tools/list` result; other results pass as they are. */
export function filterToolsListResult(
  result: unknown,
  allowed: (toolName: string) => boolean,
): unknown {
  if (!isRecord(result) || !Array.isArray(result.tools)) return result;
  return {
    ...result,
    tools: result.tools.filter(
      (tool) => isRecord(tool) && typeof tool.name === "string" && allowed(tool.name),
    ),
  };
}
