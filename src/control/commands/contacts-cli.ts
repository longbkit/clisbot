import {
  getZaloPersonalContact,
  listZaloPersonalContacts,
  listZaloPersonalFriendInvites,
  resolveZaloPersonalUsersByPhones,
  searchZaloPersonalContacts,
} from "../../channels/zalo-personal/operator-api.ts";
import {
  defaultZaloPersonalCliDependencies,
  hasFlag,
  normalizeDisplayName,
  normalizeId,
  parseOptionValue,
  parseRepeatedOption,
  parseTrailingArgs,
  printJsonOrSummary,
  requireConfirm,
  resolveZaloPersonalCliContext,
  routeExample,
  type ZaloPersonalCliDependencies,
} from "./zalo-personal-cli-common.ts";
import { renderCliCommand } from "./cli-name.ts";

function renderContactsHelp() {
  return [
    renderCliCommand("contacts"),
    "",
    "Usage:",
    `  ${renderCliCommand("contacts list --channel zalo-personal --bot <id> [--status all|online] [--favorite] [--label <label>...] [--label-match any|all] [--limit N] [--json]")}`,
    `  ${renderCliCommand("contacts search --channel zalo-personal --bot <id> [query] [--phone <phone>...] [--username <username>] [--limit N] [--json]")}`,
    `  ${renderCliCommand("contacts get --channel zalo-personal --bot <id> <user-id> [--business] [--json]")}`,
    `  ${renderCliCommand("contacts recommendations list --channel zalo-personal --bot <id> [--json]")}`,
    `  ${renderCliCommand("contacts aliases list --channel zalo-personal --bot <id> [--json]")}`,
    `  ${renderCliCommand("contacts labels list --channel zalo-personal --bot <id> [--json]")}`,
    `  ${renderCliCommand("contacts boards list --channel zalo-personal --bot <id> <conversation-id> [--json]")}`,
    `  ${renderCliCommand("contacts mutual-groups list --channel zalo-personal --bot <id> <user-id> [--json]")}`,
    `  ${renderCliCommand("contacts friend-invites list|status|send|accept|reject|cancel ...")}`,
    `  ${renderCliCommand("contacts aliases set|clear ...")}`,
    `  ${renderCliCommand("contacts labels add|update|remove|assign|unassign ...")}`,
    `  ${renderCliCommand("contacts blocked add|remove ...")}`,
    `  ${renderCliCommand("contacts feed-blocked add|remove ...")}`,
    `  ${renderCliCommand("contacts remove --channel zalo-personal --bot <id> <user-id> [--confirm]")}`,
  ].join("\n");
}

function renderFriendInvitesHelp(action?: string) {
  const usageByAction: Record<string, string> = {
    list: "contacts friend-invites list --channel zalo-personal --bot <id> [--direction incoming|sent|all] [--json]",
    status: "contacts friend-invites status --channel zalo-personal --bot <id> <user-id> [--json]",
    send: "contacts friend-invites send --channel zalo-personal --bot <id> --user <user-id> [--user <user-id>...] [--phone <phone>...] [--message <text>] --confirm [--json]",
    accept: "contacts friend-invites accept --channel zalo-personal --bot <id> <request-id-or-user-id> --confirm [--json]",
    reject: "contacts friend-invites reject --channel zalo-personal --bot <id> <request-id-or-user-id> --confirm [--json]",
    cancel: "contacts friend-invites cancel --channel zalo-personal --bot <id> <request-id-or-user-id> --confirm [--json]",
  };
  const actions = action && usageByAction[action]
    ? [usageByAction[action]]
    : Object.values(usageByAction);
  return [
    renderCliCommand("contacts friend-invites"),
    "",
    "Usage:",
    ...actions.map((usage) => `  ${renderCliCommand(usage)}`),
    "",
    "Notes:",
    "  - status takes the target Zalo user id.",
    "  - accept/reject take an inbound request id or user id and require --confirm.",
    "  - cancel takes an outbound request user id and requires --confirm.",
  ].join("\n");
}

export async function runContactsCli(
  args: string[],
  deps: ZaloPersonalCliDependencies = defaultZaloPersonalCliDependencies,
) {
  if (!args[0] || args[0] === "help") {
    deps.print(renderContactsHelp());
    return;
  }
  if (args[0] === "friend-invites" && (!args[1] || args[1] === "help" || hasFlag(args, "--help"))) {
    deps.print(renderFriendInvitesHelp(args[1] === "help" ? args[2] : args[1]));
    return;
  }
  if (hasFlag(args, "--help")) {
    deps.print(renderContactsHelp());
    return;
  }
  const ctx = await resolveZaloPersonalCliContext(args, deps);
  const api = ctx.client.api as any;
  const section = args[0];
  if (section === "list") return listContacts(args, deps, ctx.botId, api);
  if (section === "search") return searchContacts(args, deps, ctx.botId, api);
  if (section === "get") return getContact(args, deps, api);
  if (section === "recommendations" && args[1] === "list") return printRaw(args, deps, await api.getFriendRecommendations());
  if (section === "aliases") return handleAliases(args, deps, api);
  if (section === "labels") return handleLabels(args, deps, api);
  if (section === "boards" && args[1] === "list") return printRaw(args, deps, await api.getFriendBoardList(requirePositional(args, 2, "conversation-id")));
  if (section === "mutual-groups" && args[1] === "list") return printRaw(args, deps, await api.getRelatedFriendGroup(requirePositional(args, 2, "user-id")));
  if (section === "friend-invites") return handleFriendInvites(args, deps, api);
  if (section === "blocked") return handleBlocked(args, deps, api, false);
  if (section === "feed-blocked") return handleBlocked(args, deps, api, true);
  if (section === "remove") return removeContact(args, deps, api);
  throw new Error(renderContactsHelp());
}

async function listContacts(args: string[], deps: ZaloPersonalCliDependencies, botId: string, api: any) {
  const status = (parseOptionValue(args, "--status") ?? "all") as "all" | "online";
  if (status !== "all" && status !== "online") throw new Error("--status must be all or online.");
  const labelMatch = (parseOptionValue(args, "--label-match") ?? "any") as "any" | "all";
  if (labelMatch !== "any" && labelMatch !== "all") throw new Error("--label-match must be any or all.");
  const rows = await listZaloPersonalContacts(api, {
    status,
    favorite: hasFlag(args, "--favorite"),
    labels: parseRepeatedOption(args, "--label"),
    labelMatch,
    limit: parseLimit(args),
  });
  printJsonOrSummary({
    json: hasFlag(args, "--json"),
    value: rows,
    summary: rows.map((row) => `${row.userId}\t${row.displayName}\n${routeExample("dm", row.userId, botId)}`),
    print: deps.print,
  });
}

async function searchContacts(args: string[], deps: ZaloPersonalCliDependencies, botId: string, api: any) {
  const query = parseTrailingArgs(args.slice(1)).at(0);
  const rows = await searchZaloPersonalContacts(api, {
    query,
    phones: parseRepeatedOption(args, "--phone"),
    username: parseOptionValue(args, "--username"),
    limit: parseLimit(args),
  });
  printJsonOrSummary({
    json: hasFlag(args, "--json"),
    value: rows,
    summary: rows.map((row) => `${row.userId}\t${row.displayName}\n${routeExample("dm", row.userId, botId)}`),
    print: deps.print,
  });
}

async function getContact(args: string[], deps: ZaloPersonalCliDependencies, api: any) {
  const value = await getZaloPersonalContact(api, requirePositional(args, 1, "user-id"), hasFlag(args, "--business"));
  printRaw(args, deps, value);
}

async function handleFriendInvites(args: string[], deps: ZaloPersonalCliDependencies, api: any) {
  const action = args[1];
  if (action === "list") {
    const direction = (parseOptionValue(args, "--direction") ?? "incoming") as "incoming" | "sent" | "all";
    if (direction !== "incoming" && direction !== "sent" && direction !== "all") throw new Error("--direction must be incoming, sent, or all.");
    return printRaw(args, deps, await listZaloPersonalFriendInvites(api, direction));
  }
  if (action === "status") return printRaw(args, deps, await api.getFriendRequestStatus(requirePositional(args, 2, "user-id")));
  if (action === "send") return sendFriendInvite(args, deps, api);
  const userId = requirePositional(args, 2, "request-id-or-user-id");
  requireConfirm(args, `contacts friend-invites ${action}`);
  if (action === "accept") return printRaw(args, deps, await api.acceptFriendRequest(userId));
  if (action === "reject") return printRaw(args, deps, await api.rejectFriendRequest(userId));
  if (action === "cancel") return printRaw(args, deps, await api.undoFriendRequest(userId));
  throw new Error(renderContactsHelp());
}

async function sendFriendInvite(args: string[], deps: ZaloPersonalCliDependencies, api: any) {
  requireConfirm(args, "contacts friend-invites send");
  const users = parseRepeatedOption(args, "--user");
  const phones = parseRepeatedOption(args, "--phone");
  if (users.length === 0 && phones.length === 0) throw new Error("Use --user <user-id> or --phone <phone>.");
  const resolvedUsers = [...users, ...(phones.length ? await resolveZaloPersonalUsersByPhones(api, phones) : [])];
  const message = parseOptionValue(args, "--message") ?? "";
  const result = [];
  for (const userId of resolvedUsers) result.push({ userId, response: await api.sendFriendRequest(message, userId) });
  printRaw(args, deps, result);
}

async function handleAliases(args: string[], deps: ZaloPersonalCliDependencies, api: any) {
  const action = args[1];
  if (action === "list") return printRaw(args, deps, await api.getAliasList());
  const userId = requirePositional(args, 2, "user-id");
  requireConfirm(args, `contacts aliases ${action}`);
  if (action === "set") return printRaw(args, deps, await api.changeFriendAlias(parseRequiredOption(args, "--alias"), userId));
  if (action === "clear") return printRaw(args, deps, await api.removeFriendAlias(userId));
  throw new Error(renderContactsHelp());
}

async function handleLabels(args: string[], deps: ZaloPersonalCliDependencies, api: any) {
  const action = args[1];
  if (action === "list") return printRaw(args, deps, await api.getLabels());
  requireConfirm(args, `contacts labels ${action}`);
  const current = await api.getLabels();
  const labels = [...(current.labelData ?? [])];
  const next = mutateLabels(labels, args);
  printRaw(args, deps, await api.updateLabels({ labelData: next, version: current.version }));
}

function mutateLabels(labels: any[], args: string[]) {
  const action = args[1];
  if (action === "add") {
    const id = Math.max(0, ...labels.map((label) => Number(label.id) || 0)) + 1;
    labels.push({ id, text: parseRequiredOption(args, "--name"), textKey: parseRequiredOption(args, "--name"), conversations: [], color: parseOptionValue(args, "--color") ?? "", emoji: parseOptionValue(args, "--emoji") ?? "", createTime: Date.now(), offset: 0 });
    return labels;
  }
  const label = labels.find((item) => String(item.id) === requirePositional(args, 2, "label-id"));
  if (!label) throw new Error("Unknown label id.");
  if (action === "update") label.text = parseRequiredOption(args, "--name");
  else if (action === "remove") return labels.filter((item) => item !== label);
  else if (action === "assign") label.conversations = Array.from(new Set([...(label.conversations ?? []), ...parseRepeatedOption(args, "--target")]));
  else if (action === "unassign") label.conversations = (label.conversations ?? []).filter((target: string) => !parseRepeatedOption(args, "--target").includes(target));
  else throw new Error(renderContactsHelp());
  return labels;
}

async function handleBlocked(args: string[], deps: ZaloPersonalCliDependencies, api: any, feed: boolean) {
  const action = args[1];
  const userId = parseRequiredOption(args, "--user");
  requireConfirm(args, `contacts ${feed ? "feed-blocked" : "blocked"} ${action}`);
  if (action === "add") return printRaw(args, deps, feed ? await api.blockViewFeed(true, userId) : await api.blockUser(userId));
  if (action === "remove") return printRaw(args, deps, feed ? await api.blockViewFeed(false, userId) : await api.unblockUser(userId));
  throw new Error(renderContactsHelp());
}

async function removeContact(args: string[], deps: ZaloPersonalCliDependencies, api: any) {
  requireConfirm(args, "contacts remove");
  return printRaw(args, deps, await api.removeFriend(requirePositional(args, 1, "user-id")));
}

function printRaw(args: string[], deps: ZaloPersonalCliDependencies, value: unknown) {
  deps.print(hasFlag(args, "--json") ? JSON.stringify(value, null, 2) : summarizeRaw(value));
}

function summarizeRaw(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => `${normalizeId(item)}\t${normalizeDisplayName(item)}`).join("\n") || "No results.";
  if (typeof value === "string") return value || "ok";
  return JSON.stringify(value, null, 2);
}

function parseLimit(args: string[]) {
  const raw = parseOptionValue(args, "--limit");
  return raw ? Number.parseInt(raw, 10) : 50;
}

function requirePositional(args: string[], index: number, label: string) {
  const value = parseTrailingArgs(args.slice(1)).at(index - 1);
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function parseRequiredOption(args: string[], name: string) {
  const value = parseOptionValue(args, name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
