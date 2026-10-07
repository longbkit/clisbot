import type { ConnectorToolKind } from "@clisbot/protocol/connectors/types";

/**
 * Whether a tool reads, writes, or sends something to someone. The tool's own hint wins for reads:
 * Composio tags tools `readOnlyHint` and MCP servers annotate `readOnlyHint`, which also covers
 * names whose verb comes last (`GOOGLECALENDAR_EVENTS_LIST`). Without a hint the name decides:
 * Composio names tools `TOOLKIT_ACTION_OBJECT` (`GMAIL_SEND_EMAIL`); MCP servers name them
 * freely (`create_issue`, `sendMessage`). The rule follows OpenMausBot's outbound gate: a read verb
 * first means a read, a send verb anywhere means a send, and creating something people receive
 * (a message, a comment, an invoice) or changing who may access something (an ACL) is a send too.
 * A call that names people to notify (attendees, recipients) is a send whatever its name
 * (`connectorCallKind`): a calendar event with attendees emails them an invitation.
 */

/** What a tool says about itself; `readOnly: false` means it changes data. */
export interface ConnectorToolHints {
  readOnly?: boolean;
}

const READ_VERBS = new Set([
  "GET",
  "LIST",
  "FETCH",
  "SEARCH",
  "READ",
  "FIND",
  "RETRIEVE",
  "LOOKUP",
  "DOWNLOAD",
  "VIEW",
  "CHECK",
  "COUNT",
  "QUERY",
  "DESCRIBE",
]);

const SEND_VERBS = new Set([
  "SEND",
  "SENDS",
  "REPLY",
  "RESPOND",
  "FORWARD",
  "POST",
  "PUBLISH",
  "TWEET",
  "RETWEET",
  "BROADCAST",
  "INVITE",
  "SHARE",
  "SHARING",
  "REFUND",
  "CHARGE",
  "PAY",
  "PAYOUT",
  "TRANSFER",
]);

/**
 * Words of a tool that runs whatever text it is given (SQL, GraphQL, a shell command): it can
 * change data whatever verb comes first, so it never counts as a read.
 */
const FREE_FORM_WORDS = new Set(["SQL", "GRAPHQL", "MUTATION", "STATEMENT", "COMMAND", "SCRIPT"]);

const CREATE_VERBS = new Set(["CREATE", "ADD", "NEW"]);
/** Verbs that change an access list: granting someone access to a calendar or a file. */
const ACCESS_CHANGE_VERBS = new Set(["INSERT", "CREATE", "ADD", "PATCH", "UPDATE"]);
const RECEIVED_NOUNS = new Set([
  "MESSAGE",
  "COMMENT",
  "POST",
  "EMAIL",
  "MAIL",
  "INVOICE",
  "PAYMENT",
  "REFUND",
  "REPLY",
  "TWEET",
  "DM",
]);

/** Composio's executor can call any HTTP endpoint of a connected app. */
const COMPOSIO_PROXY_TOOL = "COMPOSIO_PROXY_EXECUTE";

/** The action words of a tool name, upper case, with a Composio toolkit prefix dropped. */
export function actionWords(name: string, toolkit?: string): string[] {
  let action = name;
  if (toolkit && name.toUpperCase().startsWith(`${toolkit.toUpperCase()}_`)) {
    action = name.slice(toolkit.length + 1);
  } else if (/^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(name)) {
    action = name.slice(name.indexOf("_") + 1);
  }
  return action
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

export function classifyConnectorTool(
  name: string,
  toolkit?: string,
  hints?: ConnectorToolHints,
): ConnectorToolKind {
  if (name === COMPOSIO_PROXY_TOOL) return "send";
  const words = actionWords(name, toolkit);
  const byName = kindFromWords(words);
  if (hints?.readOnly === true) return "read";
  // The tool says it changes data: a read-looking name does not make it a read.
  return hints?.readOnly === false && byName === "read" ? "write" : byName;
}

function kindFromWords(words: string[]): ConnectorToolKind {
  if (words.length === 0) return "write";
  if (isRead(words)) return "read";
  if (words.some((word) => SEND_VERBS.has(word))) return "send";
  if (words.includes("ACL") && words.some((word) => ACCESS_CHANGE_VERBS.has(word))) return "send";
  if (words.includes("DRAFT")) return "write";
  const createsReceived =
    words.some((word) => CREATE_VERBS.has(word)) && words.some((word) => RECEIVED_NOUNS.has(word));
  return createsReceived ? "send" : "write";
}

/** Argument names that put people on the receiving end of a call. */
const RECIPIENT_KEYS = new Set([
  "to",
  "cc",
  "bcc",
  "recipient",
  "recipients",
  "attendee",
  "attendees",
  "invitee",
  "invitees",
  "guests",
  "participants",
]);

/** A call's kind: its tool's, raised to a send when the call names people to notify. */
export function connectorCallKind(
  tool: { name: string; toolkit?: string; hints?: ConnectorToolHints },
  args: unknown,
): ConnectorToolKind {
  const kind = classifyConnectorTool(tool.name, tool.toolkit, tool.hints);
  // A draft names its recipients but reaches no one until it is sent.
  if (kind !== "write" || actionWords(tool.name, tool.toolkit).includes("DRAFT")) return kind;
  return namesRecipients(args, 0) ? "send" : kind;
}

function namesRecipients(value: unknown, depth: number): boolean {
  if (depth > 3 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => namesRecipients(item, depth + 1));
  return Object.entries(value).some(
    ([key, item]) =>
      (RECIPIENT_KEYS.has(key.toLowerCase()) && hasValue(item)) || namesRecipients(item, depth + 1),
  );
}

function hasValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "";
  return value !== null && value !== undefined;
}

/**
 * A read verb first, and nothing that runs free-form text. A bare `QUERY` (`GOOGLEBIGQUERY_QUERY`)
 * runs whatever it is given; `QUERY_DATABASE` names what it reads.
 */
function isRead(words: string[]): boolean {
  if (!READ_VERBS.has(words[0]!)) return false;
  if (words[0] === "QUERY" && words.length === 1) return false;
  return !words.some((word) => FREE_FORM_WORDS.has(word));
}
