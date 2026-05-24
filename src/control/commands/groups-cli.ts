import {
  getZaloPersonalGroup,
  listZaloPersonalGroupMembers,
  listZaloPersonalGroups,
  resolveZaloPersonalUsersByPhones,
  searchZaloPersonalGroups,
} from "../../channels/zalo-personal/operator-api.ts";
import {
  defaultZaloPersonalCliDependencies,
  hasFlag,
  parseOptionValue,
  parseRepeatedOption,
  parseTrailingArgs,
  printJsonOrSummary,
  readAttachmentSource,
  requireConfirm,
  resolveZaloPersonalCliContext,
  routeExample,
  type ZaloPersonalCliDependencies,
} from "./zalo-personal-cli-common.ts";
import { renderCliCommand } from "./cli-name.ts";

function renderGroupsHelp() {
  return [
    renderCliCommand("groups"),
    "",
    "Usage:",
    `  ${renderCliCommand("groups list|search|get --channel zalo-personal --bot <id> ...")}`,
    `  ${renderCliCommand("groups members list|add|remove --channel zalo-personal --bot <id> <group-id> ...")}`,
    `  ${renderCliCommand("groups boards list --channel zalo-personal --bot <id> <group-id> [--page N] [--limit N] [--json]")}`,
    `  ${renderCliCommand("groups group-invites list|get|send|accept|reject|cancel ...")}`,
    `  ${renderCliCommand("groups pending list|approve|reject --channel zalo-personal --bot <id> <group-id> ...")}`,
    `  ${renderCliCommand("groups blocked list|add|remove --channel zalo-personal --bot <id> <group-id> ...")}`,
    `  ${renderCliCommand("groups invite-link get|enable|disable --channel zalo-personal --bot <id> <group-id> ...")}`,
    `  ${renderCliCommand("groups add|update|join --channel zalo-personal --bot <id> ...")}`,
  ].join("\n");
}

function renderGroupAddHelp() {
  return [
    renderCliCommand("groups add"),
    "",
    "Usage:",
    `  ${renderCliCommand("groups add --channel zalo-personal --bot <id> --name <name> --user <user-id> [--user <user-id>...] --confirm [--json]")}`,
    "",
    "Required flags:",
    "  --name <name>       New Zalo group name.",
    "  --user <user-id>    Initial member raw Zalo user id. Repeat for more members.",
    "  --confirm           Required because this creates a real Zalo group.",
    "",
    "Notes:",
    "  - Use contacts search first when you only know a person's name or phone number.",
    "  - The current Zalo account becomes a member automatically when Zalo creates the group.",
    "",
    "Examples:",
    `  ${renderCliCommand("contacts search --channel zalo-personal --bot default \"Na\"")}`,
    `  ${renderCliCommand("groups add --channel zalo-personal --bot default --name \"Gia đình\" --user 8150872152578633027 --user 123456789 --confirm")}`,
  ].join("\n");
}

function renderGroupMembersHelp(action?: string) {
  const usageByAction: Record<string, string> = {
    list: "groups members list --channel zalo-personal --bot <id> <group-id> [--limit N] [--json]",
    add: "groups members add --channel zalo-personal --bot <id> <group-id> --user <user-id> [--user <user-id>...] --confirm [--json]",
    remove: "groups members remove --channel zalo-personal --bot <id> <group-id> --user <user-id> [--user <user-id>...] --confirm [--json]",
  };
  const actions = action && usageByAction[action] ? [usageByAction[action]] : Object.values(usageByAction);
  return [
    renderCliCommand("groups members"),
    "",
    "Usage:",
    ...actions.map((usage) => `  ${renderCliCommand(usage)}`),
    "",
    "Required values:",
    "  <group-id>          Raw Zalo group id. Use groups list/search to find it.",
    "  --user <user-id>    Raw Zalo user id for add/remove. Repeat for more users.",
    "  --confirm           Required for add/remove because they change real membership.",
    "",
    "Examples:",
    `  ${renderCliCommand("groups search --channel zalo-personal --bot default \"Gia đình\"")}`,
    `  ${renderCliCommand("groups members add --channel zalo-personal --bot default 3374540724734114698 --user 123456789 --confirm")}`,
    `  ${renderCliCommand("groups members list --channel zalo-personal --bot default 3374540724734114698 --json")}`,
  ].join("\n");
}

export async function runGroupsCli(
  args: string[],
  deps: ZaloPersonalCliDependencies = defaultZaloPersonalCliDependencies,
) {
  if (!args[0] || args[0] === "help") {
    deps.print(renderGroupsHelp());
    return;
  }
  if (args[0] === "add" && hasFlag(args, "--help")) {
    deps.print(renderGroupAddHelp());
    return;
  }
  if (args[0] === "members" && (!args[1] || args[1] === "help" || hasFlag(args, "--help"))) {
    deps.print(renderGroupMembersHelp(args[1] === "help" ? args[2] : args[1]));
    return;
  }
  if (hasFlag(args, "--help")) {
    deps.print(renderGroupsHelp());
    return;
  }
  const ctx = await resolveZaloPersonalCliContext(args, deps);
  const api = ctx.client.api as any;
  const section = args[0];
  if (section === "list") return listGroups(args, deps, ctx.botId, api);
  if (section === "search") return searchGroups(args, deps, ctx.botId, api);
  if (section === "get") return printRaw(args, deps, await getZaloPersonalGroup(api, requirePositional(args, 1, "group-id")));
  if (section === "members") return handleMembers(args, deps, api);
  if (section === "boards" && args[1] === "list") return printRaw(args, deps, await api.getListBoard({ page: parseIntOpt(args, "--page", 1), count: parseIntOpt(args, "--limit", 20) }, requirePositional(args, 2, "group-id")));
  if (section === "group-invites") return handleGroupInvites(args, deps, api);
  if (section === "pending") return handlePending(args, deps, api);
  if (section === "blocked") return handleBlocked(args, deps, api);
  if (section === "invite-link") return handleInviteLink(args, deps, api);
  if (section === "add") return addGroup(args, deps, api);
  if (section === "update") return updateGroup(args, deps, api);
  if (section === "avatar" && args[1] === "set") return setAvatar(args, deps, api);
  if (section === "join") return mutate(args, deps, () => api.joinGroupLink(requirePositional(args, 1, "invite-url-or-token")), "groups join");
  throw new Error(renderGroupsHelp());
}

async function listGroups(args: string[], deps: ZaloPersonalCliDependencies, botId: string, api: any) {
  const rows = await listZaloPersonalGroups(api, parseIntOpt(args, "--limit", 50));
  printJsonOrSummary({
    json: hasFlag(args, "--json"),
    value: rows,
    summary: rows.map((row) => `${row.groupId}\t${row.name}${row.memberCount ? `\tmembers=${row.memberCount}` : ""}\n${routeExample("group", row.groupId, botId)}`),
    print: deps.print,
  });
}

async function searchGroups(args: string[], deps: ZaloPersonalCliDependencies, botId: string, api: any) {
  const rows = await searchZaloPersonalGroups(api, requirePositional(args, 1, "query"), parseIntOpt(args, "--limit", 50));
  printJsonOrSummary({
    json: hasFlag(args, "--json"),
    value: rows,
    summary: rows.map((row) => `${row.groupId}\t${row.name}\n${routeExample("group", row.groupId, botId)}`),
    print: deps.print,
  });
}

async function handleMembers(args: string[], deps: ZaloPersonalCliDependencies, api: any) {
  const action = args[1];
  const groupId = requirePositional(args, 2, "group-id");
  if (action === "list") return printRaw(args, deps, await listZaloPersonalGroupMembers(api, groupId, parseIntOpt(args, "--limit", 100)));
  const users = parseRepeatedOption(args, "--user");
  if (users.length === 0) throw new Error("--user is required.");
  if (action === "add") return mutate(args, deps, () => api.addUserToGroup(users, groupId), "groups members add");
  if (action === "remove") return mutate(args, deps, () => api.removeUserFromGroup(users, groupId), "groups members remove");
  throw new Error(renderGroupsHelp());
}

async function handleGroupInvites(args: string[], deps: ZaloPersonalCliDependencies, api: any) {
  const action = args[1];
  if (action === "list") return printRaw(args, deps, await api.getGroupInviteBoxList());
  if (action === "get") return printRaw(args, deps, await api.getGroupInviteBoxInfo({ groupId: requirePositional(args, 2, "invite-id") }));
  if (action === "send") return sendGroupInvites(args, deps, api);
  if (action === "accept") return mutate(args, deps, () => api.joinGroupInviteBox(requirePositional(args, 2, "invite-id")), "groups group-invites accept");
  if (action === "reject") return mutate(args, deps, () => api.deleteGroupInviteBox(requirePositional(args, 2, "invite-id"), false), "groups group-invites reject");
  if (action === "cancel") throw new Error("zca-js does not expose an outbound group invitation cancel API; reject only declines inbound invites.");
  throw new Error(renderGroupsHelp());
}

async function sendGroupInvites(args: string[], deps: ZaloPersonalCliDependencies, api: any) {
  requireConfirm(args, "groups group-invites send");
  const groupId = parseRequiredOption(args, "--group");
  const users = [...parseRepeatedOption(args, "--user")];
  const phones = parseRepeatedOption(args, "--phone");
  if (phones.length) users.push(...await resolveZaloPersonalUsersByPhones(api, phones));
  if (users.length === 0) throw new Error("Use --user or --phone.");
  const result = [];
  for (const userId of users) result.push({ userId, response: await api.inviteUserToGroups(userId, groupId) });
  printRaw(args, deps, result);
}

async function handlePending(args: string[], deps: ZaloPersonalCliDependencies, api: any) {
  const action = args[1];
  const groupId = requirePositional(args, 2, "group-id");
  if (action === "list") return printRaw(args, deps, await api.getPendingGroupMembers(groupId));
  const user = parseRequiredOption(args, "--user");
  if (action === "approve") return mutate(args, deps, () => api.reviewPendingMemberRequest({ members: user, isApprove: true }, groupId), "groups pending approve");
  if (action === "reject") return mutate(args, deps, () => api.reviewPendingMemberRequest({ members: user, isApprove: false }, groupId), "groups pending reject");
  throw new Error(renderGroupsHelp());
}

async function handleBlocked(args: string[], deps: ZaloPersonalCliDependencies, api: any) {
  const action = args[1];
  const groupId = requirePositional(args, 2, "group-id");
  if (action === "list") return printRaw(args, deps, await api.getGroupBlockedMember({ page: 1, count: 50 }, groupId));
  const user = parseRequiredOption(args, "--user");
  if (action === "add") return mutate(args, deps, () => api.addGroupBlockedMember(user, groupId), "groups blocked add");
  if (action === "remove") return mutate(args, deps, () => api.removeGroupBlockedMember(user, groupId), "groups blocked remove");
  throw new Error(renderGroupsHelp());
}

async function handleInviteLink(args: string[], deps: ZaloPersonalCliDependencies, api: any) {
  const action = args[1];
  const groupId = requirePositional(args, 2, "group-id");
  if (action === "get") return printRaw(args, deps, await api.getGroupLinkDetail(groupId));
  if (action === "enable") return mutate(args, deps, () => api.enableGroupLink(groupId), "groups invite-link enable");
  if (action === "disable") return mutate(args, deps, () => api.disableGroupLink(groupId), "groups invite-link disable");
  throw new Error(renderGroupsHelp());
}

async function addGroup(args: string[], deps: ZaloPersonalCliDependencies, api: any) {
  return mutate(args, deps, () => api.createGroup({
    name: parseOptionValue(args, "--name"),
    members: parseRepeatedOption(args, "--user"),
  }), "groups add");
}

async function updateGroup(args: string[], deps: ZaloPersonalCliDependencies, api: any) {
  return mutate(args, deps, () => api.changeGroupName(parseRequiredOption(args, "--name"), requirePositional(args, 1, "group-id")), "groups update");
}

async function setAvatar(args: string[], deps: ZaloPersonalCliDependencies, api: any) {
  const source = await readAttachmentSource(parseRequiredOption(args, "--file"), deps);
  return mutate(args, deps, () => api.changeGroupAvatar(source, requirePositional(args, 2, "group-id")), "groups avatar set");
}

async function mutate(args: string[], deps: ZaloPersonalCliDependencies, fn: () => Promise<unknown>, label: string) {
  requireConfirm(args, label);
  printRaw(args, deps, await fn());
}

function printRaw(args: string[], deps: ZaloPersonalCliDependencies, value: unknown) {
  deps.print(hasFlag(args, "--json") ? JSON.stringify(value, null, 2) : (typeof value === "string" ? value || "ok" : JSON.stringify(value, null, 2)));
}

function parseIntOpt(args: string[], name: string, fallback: number) {
  const raw = parseOptionValue(args, name);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} requires a non-negative integer.`);
  return value;
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
