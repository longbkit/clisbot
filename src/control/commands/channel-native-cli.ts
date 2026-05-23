import {
  parseZaloPersonalMentionSpec,
  parseZaloPersonalStyleSpec,
  parseZaloPersonalUrgency,
  renderZaloPersonalMessage,
} from "../../channels/zalo-personal/message-render.ts";
import { withZaloPersonalUploadListener } from "../../channels/zalo-personal/message-actions.ts";
import {
  defaultZaloPersonalCliDependencies,
  hasFlag,
  parseJsonOption,
  parseOptionValue,
  parseRepeatedOption,
  parseTrailingArgs,
  parseZaloPersonalTarget,
  readAttachmentSource,
  requireConfirm,
  resolveZaloPersonalCliContext,
  type ZaloPersonalCliDependencies,
} from "./zalo-personal-cli-common.ts";
import { renderCliCommand } from "./cli-name.ts";

function renderChannelNativeHelp() {
  return [
    renderCliCommand("channel-native"),
    "",
    "Usage:",
    `  ${renderCliCommand("channel-native --channel zalo-personal --bot <id> messages send --target <target> --message <text> [--quote <json>] [--mention <uid:pos:len>...] [--style <style:pos:len>...] [--urgency default|important|urgent|0|1|2] [--ttl <ms>]")}`,
    `  ${renderCliCommand("channel-native --channel zalo-personal --bot <id> messages link send --target <target> <url> [--message <text>] [--ttl <ms>]")}`,
    `  ${renderCliCommand("channel-native --channel zalo-personal --bot <id> messages parse-link <url> [--json]")}`,
    `  ${renderCliCommand("channel-native --channel zalo-personal --bot <id> messages upload --target <target> --file <path> [--json]")}`,
    `  ${renderCliCommand("channel-native --channel zalo-personal --bot <id> messages contact-card|bank-card|typing|delivered|seen|undo|forward|polls|report ...")}`,
  ].join("\n");
}

export async function runChannelNativeCli(
  args: string[],
  deps: ZaloPersonalCliDependencies = defaultZaloPersonalCliDependencies,
) {
  if (!args[0] || args[0] === "help" || hasFlag(args, "--help")) {
    deps.print(renderChannelNativeHelp());
    return;
  }
  if (parseOptionValue(args, "--channel") !== "zalo-personal") {
    throw new Error("Only --channel zalo-personal is implemented for channel-native commands.");
  }
  const ctx = await resolveZaloPersonalCliContext(args, deps);
  const api = ctx.client.api as any;
  const messagesIndex = args.indexOf("messages");
  if (messagesIndex === -1) throw new Error(renderChannelNativeHelp());
  return handleMessages(args.slice(messagesIndex + 1), args, deps, ctx.client, api);
}

async function handleMessages(local: string[], global: string[], deps: ZaloPersonalCliDependencies, client: any, api: any) {
  const action = local[0];
  if (action === "send") return sendEnhanced(global, deps, client, api);
  if (action === "link" && local[1] === "send") return sendLink(local, global, deps, client, api);
  if (action === "parse-link") return printRaw(global, deps, await api.parseLink(requireLocalPositional(local, 1, "url")));
  if (action === "upload") return upload(global, deps, client, api);
  if (action === "contact-card" && local[1] === "send") return sendContactCard(global, deps, client, api);
  if (action === "bank-card" && local[1] === "send") return sendBankCard(global, deps, client, api);
  if (action === "typing") return withTarget(global, client, async (target) => printRaw(global, deps, await api.sendTypingEvent(target.id, target.threadType)));
  if (action === "delivered") return sendEvent(global, deps, client, api, "delivered");
  if (action === "seen") return sendEvent(global, deps, client, api, "seen");
  if (action === "undo") return mutate(global, deps, () => withTarget(global, client, (target) => api.undo(parseMessageLocator(parseRequiredOption(global, "--message-id")), target.id, target.threadType)), "messages undo");
  if (action === "forward") return forwardMessage(global, deps, client, api);
  if (action === "polls") return handlePolls(local.slice(1), global, deps, client, api);
  if (action === "report") return report(global, deps, client, api);
  throw new Error(renderChannelNativeHelp());
}

async function sendEnhanced(global: string[], deps: ZaloPersonalCliDependencies, client: any, api: any) {
  const target = parseZaloPersonalTarget(parseOptionValue(global, "--target"), client);
  const rendered = renderZaloPersonalMessage({
    text: parseRequiredOption(global, "--message"),
    inputFormat: "md",
    renderMode: "native",
    extraStyles: parseRepeatedOption(global, "--style").map(parseZaloPersonalStyleSpec),
    extraMentions: parseRepeatedOption(global, "--mention").map(parseZaloPersonalMentionSpec),
  });
  const ttl = parseIntOption(global, "--ttl");
  const content = {
    msg: rendered.text,
    ...(rendered.styles ? { styles: rendered.styles } : {}),
    ...(rendered.mentions ? { mentions: rendered.mentions } : {}),
    ...(parseOptionValue(global, "--quote") ? { quote: parseJsonOption(parseOptionValue(global, "--quote"), "--quote") } : {}),
    ...(parseOptionValue(global, "--urgency") ? { urgency: parseZaloPersonalUrgency(parseOptionValue(global, "--urgency")) } : {}),
    ...(ttl !== undefined ? { ttl } : {}),
  };
  printRaw(global, deps, await api.sendMessage(content, target.id, target.threadType));
}

async function sendLink(local: string[], global: string[], deps: ZaloPersonalCliDependencies, client: any, api: any) {
  const target = parseZaloPersonalTarget(parseOptionValue(global, "--target"), client);
  printRaw(global, deps, await api.sendLink({
    link: requireLocalPositional(local, 2, "url"),
    msg: parseOptionValue(global, "--message"),
    ttl: parseIntOption(global, "--ttl"),
  }, target.id, target.threadType));
}

async function upload(global: string[], deps: ZaloPersonalCliDependencies, client: any, api: any) {
  const target = parseZaloPersonalTarget(parseOptionValue(global, "--target"), client);
  const source = await readAttachmentSource(parseRequiredOption(global, "--file"), deps);
  printRaw(global, deps, await withZaloPersonalUploadListener(client, () => api.uploadAttachment(source, target.id, target.threadType)));
}

async function sendContactCard(global: string[], deps: ZaloPersonalCliDependencies, client: any, api: any) {
  const target = parseZaloPersonalTarget(parseOptionValue(global, "--target"), client);
  printRaw(global, deps, await api.sendCard({ userId: parseRequiredOption(global, "--user") }, target.id, target.threadType));
}

async function sendBankCard(global: string[], deps: ZaloPersonalCliDependencies, client: any, api: any) {
  const target = parseZaloPersonalTarget(parseOptionValue(global, "--target"), client);
  const rawBinBank = parseRequiredOption(global, "--bin-bank");
  const binBank = rawBinBank.trim().startsWith("{") ? parseJsonOption(rawBinBank, "--bin-bank") : rawBinBank;
  printRaw(global, deps, await api.sendBankCard({
    binBank,
    numAccBank: parseRequiredOption(global, "--account-number"),
    nameAccBank: parseOptionValue(global, "--account-name"),
  }, target.id, target.threadType));
}

async function sendEvent(global: string[], deps: ZaloPersonalCliDependencies, client: any, api: any, kind: "delivered" | "seen") {
  const target = parseZaloPersonalTarget(parseOptionValue(global, "--target"), client);
  const message = parseEventMessage(parseRequiredOption(global, "--message-id"), target.id);
  printRaw(global, deps, kind === "seen"
    ? await api.sendSeenEvent(message, target.threadType)
    : await api.sendDeliveredEvent(false, message, target.threadType));
}

async function forwardMessage(global: string[], deps: ZaloPersonalCliDependencies, client: any, api: any) {
  requireConfirm(global, "messages forward");
  const to = parseZaloPersonalTarget(parseOptionValue(global, "--to"), client);
  const ttl = parseIntOption(global, "--ttl");
  const payload = {
    message: parseRequiredOption(global, "--message"),
    ...(parseOptionValue(global, "--reference") ? { reference: parseJsonOption(parseOptionValue(global, "--reference"), "--reference") } : {}),
    ...(ttl !== undefined ? { ttl } : {}),
  };
  printRaw(global, deps, await api.forwardMessage(payload, [to.id], to.threadType));
}

async function handlePolls(local: string[], global: string[], deps: ZaloPersonalCliDependencies, client: any, api: any) {
  const action = local[0];
  if (action === "add") return withTarget(global, client, async (target) => printRaw(global, deps, await api.createPoll({ question: parseRequiredOption(global, "--question"), options: parseRepeatedOption(global, "--option") }, target.id)));
  if (action === "vote") return printRaw(global, deps, await api.votePoll(Number(parseRequiredOption(global, "--poll-id")), parseRepeatedOption(global, "--option").map(Number)));
  if (action === "lock") return mutate(global, deps, () => api.lockPoll(Number(parseRequiredOption(global, "--poll-id"))), "messages polls lock");
  if (action === "get") return printRaw(global, deps, await api.getPollDetail(Number(parseRequiredOption(global, "--poll-id"))));
  if (action === "options" && local[1] === "add") return mutate(global, deps, () => api.addPollOptions({ pollId: Number(parseRequiredOption(global, "--poll-id")), options: parseRepeatedOption(global, "--option").map((content) => ({ content, voted: false })), votedOptionIds: [] }), "messages polls options add");
  if (action === "share") return mutate(global, deps, () => api.sharePoll(Number(parseRequiredOption(global, "--poll-id"))), "messages polls share");
  throw new Error(renderChannelNativeHelp());
}

async function report(global: string[], deps: ZaloPersonalCliDependencies, client: any, api: any) {
  return mutate(global, deps, () => withTarget(global, client, (target) => api.sendReport({ reason: resolveReportReason(parseRequiredOption(global, "--reason")), content: parseOptionValue(global, "--content") ?? "" }, target.id, target.threadType)), "messages report");
}

async function withTarget<T>(global: string[], client: any, fn: (target: ReturnType<typeof parseZaloPersonalTarget>) => Promise<T>) {
  return await fn(parseZaloPersonalTarget(parseOptionValue(global, "--target"), client));
}

async function mutate(args: string[], deps: ZaloPersonalCliDependencies, fn: () => Promise<unknown>, label: string) {
  requireConfirm(args, label);
  printRaw(args, deps, await fn());
}

function printRaw(args: string[], deps: ZaloPersonalCliDependencies, value: unknown) {
  deps.print(hasFlag(args, "--json") ? JSON.stringify(value, null, 2) : (typeof value === "string" ? value || "ok" : JSON.stringify(value, null, 2)));
}

function parseMessageLocator(raw: string) {
  if (raw.trim().startsWith("{")) {
    return parseJsonOption<any>(raw, "--message-id");
  }
  const [msgId, cliMsgId = msgId] = raw.split(":");
  return { msgId, cliMsgId };
}

function parseEventMessage(raw: string, targetId: string) {
  if (raw.trim().startsWith("{")) {
    return parseJsonOption<any>(raw, "--message-id");
  }
  const [msgId, cliMsgId = msgId, uidFrom = "", ts = Date.now().toString()] = raw.split(":");
  return { msgId, cliMsgId, uidFrom, idTo: targetId, msgType: "webchat", st: 0, at: 0, cmd: 0, ts };
}

function resolveReportReason(raw: string) {
  return raw === "sensitive" ? 1 : raw === "annoy" ? 2 : raw === "fraud" ? 3 : 0;
}

function parseIntOption(args: string[], name: string) {
  const raw = parseOptionValue(args, name);
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} requires a non-negative integer.`);
  return value;
}

function requireLocalPositional(args: string[], index: number, label: string) {
  const value = parseTrailingArgs(args).at(index);
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function parseRequiredOption(args: string[], name: string) {
  const value = parseOptionValue(args, name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
