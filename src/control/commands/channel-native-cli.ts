import {
  resolveZaloPersonalUploadedUrl,
} from "../../channels/zalo-personal/attachment-source.ts";
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

const channelNativeMessageUsages = [
  "messages send --target <target> --message <text> [--quote <json>] [--mention <uid:pos:len>...] [--style <style:pos:len>...] [--urgency default|important|urgent|0|1|2] [--ttl <ms>]",
  "messages link send --target <target> <url> [--message <text>] [--ttl <ms>]",
  "messages video send --target <target> --file <path-or-url> --thumbnail <path-or-url> [--message <text>] [--duration-ms <ms>] [--width <px>] [--height <px>] [--ttl <ms>]",
  "messages parse-link <url> [--json]",
  "messages upload --target <target> --file <path-or-url> [--json]",
  "messages contact-card|bank-card|typing|delivered|seen|undo|forward|polls|report ...",
];

const channelNativeStickerUsages = [
  "stickers list --query <query> [--limit <n>] [--detail] [--json]",
  "stickers search <query> [--limit <n>] [--detail] [--json]",
  "stickers get <sticker-id> [--json]",
  "stickers send --target <target> --id <id> --category <cate-id> --type <type> [--json]",
  "stickers categories get <category-id> [--json]",
];

const defaultStickerLimit = 10;

const channelNativeMessageHelp: Record<string, { usages: string[]; notes: string[] }> = {
  send: {
    usages: [channelNativeMessageUsages[0]],
    notes: [
      "--target accepts dm:<id> or group:<id>.",
      "Prefer mention placeholders in --message, for example <@uid|Name>; --mention is the low-level uid:pos:len fallback.",
      "--style accepts style:pos:len. Styles: bold, italic, underline, strike, red, orange, yellow, green, small, big, unordered-list, ordered-list, indent.",
    ],
  },
  link: {
    usages: [channelNativeMessageUsages[1], "messages parse-link <url> [--json]"],
    notes: ["Zalo parses title, description, thumbnail, and source metadata from the URL."],
  },
  video: {
    usages: [channelNativeMessageUsages[2]],
    notes: [
      "--file and --thumbnail accept local paths or URLs; clisbot downloads first, uploads both to Zalo, then sends the native video payload.",
      "Provide a real thumbnail image when preview quality matters; do not rely on Zalo to generate a stable first-frame thumbnail.",
    ],
  },
  "parse-link": {
    usages: [channelNativeMessageUsages[3]],
    notes: ["Returns Zalo's parsed link metadata without sending a message."],
  },
  upload: {
    usages: [channelNativeMessageUsages[4]],
    notes: ["Diagnostic/pre-upload helper. Normal sends with --file should use the shared message command when possible."],
  },
  "contact-card": {
    usages: ["messages contact-card send --target <target> --user <user-id> [--json]"],
    notes: ["Sends a Zalo-native contact card for one user id."],
  },
  "bank-card": {
    usages: ["messages bank-card send --target <target> --bin-bank <json-or-code> --account-number <account-number> [--account-name <name>] [--json]"],
    notes: ["--bin-bank may be a bank code or the JSON payload expected by zca-js."],
  },
  typing: {
    usages: ["messages typing --target <target> [--json]"],
    notes: ["Sends one Zalo typing indicator event."],
  },
  delivered: {
    usages: ["messages delivered --target <target> --message-id <msgId[:cliMsgId[:uidFrom[:ts]]]> [--json]"],
    notes: ["--message-id also accepts the raw JSON locator payload."],
  },
  seen: {
    usages: ["messages seen --target <target> --message-id <msgId[:cliMsgId[:uidFrom[:ts]]]> [--json]"],
    notes: ["--message-id also accepts the raw JSON locator payload."],
  },
  undo: {
    usages: ["messages undo --target <target> --message-id <msgId[:cliMsgId]> --confirm [--json]"],
    notes: ["Recalls one sent message and requires --confirm."],
  },
  forward: {
    usages: ["messages forward --to <target> --message <text> [--reference <json>] [--ttl <ms>] --confirm [--json]"],
    notes: ["Forwards the supplied message payload; it does not fetch a source message by id. Requires --confirm."],
  },
  report: {
    usages: ["messages report --target <target> --reason sensitive|annoy|fraud|other [--content <text>] --confirm [--json]"],
    notes: ["Reports a Zalo conversation/message target and requires --confirm."],
  },
};

const channelNativePollsHelp: Record<string, { usages: string[]; notes: string[] }> = {
  add: {
    usages: ["messages polls add --target <target> --question <text> --option <text>... [--json]"],
    notes: ["Creates a poll in the target conversation."],
  },
  vote: {
    usages: ["messages polls vote --target <target> --poll-id <id> --option <id>... [--json]"],
    notes: ["Votes for one or more poll option ids."],
  },
  lock: {
    usages: ["messages polls lock --target <target> --poll-id <id> --confirm [--json]"],
    notes: ["Locks/closes a poll and requires --confirm."],
  },
  get: {
    usages: ["messages polls get --target <target> --poll-id <id> --confirm [--json]"],
    notes: ["Fetches poll detail/results. Treat as sensitive because provider payloads may include voter ids."],
  },
  options: {
    usages: ["messages polls options add --target <target> --poll-id <id> --option <text>... --confirm [--json]"],
    notes: ["Adds options to an existing poll and requires --confirm."],
  },
  share: {
    usages: ["messages polls share --poll-id <id> --confirm [--json]"],
    notes: ["Shares a poll through zca-js' native endpoint; current zca-js does not expose a destination flag. Requires --confirm."],
  },
};

function renderChannelNativeHelp(path: string[] = []) {
  if (path[0] === "messages") return renderChannelNativeMessagesHelp(path.slice(1));
  if (path[0] === "stickers") return renderChannelNativeStickersHelp(path.slice(1));
  return [
    renderCliCommand("channel-native"),
    "",
    "Usage:",
    ...channelNativeMessageUsages.map((usage) => (
      `  ${renderCliCommand(`channel-native --channel zalo-personal --bot <id> ${usage}`)}`
    )),
    ...channelNativeStickerUsages.map((usage) => (
      `  ${renderCliCommand(`channel-native --channel zalo-personal --bot <id> ${usage}`)}`
    )),
    "",
    "Help:",
    `  ${renderCliCommand("channel-native --channel zalo-personal messages send --help")}`,
    `  ${renderCliCommand("channel-native --channel zalo-personal messages polls --help")}`,
    `  ${renderCliCommand("channel-native --channel zalo-personal stickers --help")}`,
  ].join("\n");
}

function renderChannelNativeMessagesHelp(path: string[]) {
  if (!path[0]) return renderHelpBlock("channel-native messages", channelNativeMessageUsages, [
    "--target accepts dm:<id> or group:<id>.",
    "Use subcommand --help for exact flags and confirmation requirements.",
  ]);
  if (path[0] === "polls") return renderChannelNativePollsHelp(path.slice(1));
  const help = channelNativeMessageHelp[path[0]];
  if (help) return renderHelpBlock(`channel-native messages ${path[0]}`, help.usages, help.notes);
  return renderHelpBlock("channel-native messages", channelNativeMessageUsages, [
    "Unknown messages subcommand. Use one of: send, link, video, parse-link, upload, contact-card, bank-card, typing, delivered, seen, undo, forward, polls, report.",
  ]);
}

function renderChannelNativePollsHelp(path: string[]) {
  const key = path[0] === "options" ? "options" : path[0];
  const help = key ? channelNativePollsHelp[key] : undefined;
  if (help) return renderHelpBlock(`channel-native messages polls ${key}`, help.usages, help.notes);
  return renderHelpBlock("channel-native messages polls", Object.values(channelNativePollsHelp).flatMap((entry) => entry.usages), [
    "Mutating poll operations lock, options add, and share require --confirm.",
    "Poll detail reads require --confirm because provider payloads may include voter ids.",
  ]);
}

function renderChannelNativeStickersHelp(path: string[]) {
  const action = path[0] === "categories" ? "categories" : path[0];
  const usages = action === "send"
    ? [channelNativeStickerUsages[3]]
    : action === "categories"
    ? [channelNativeStickerUsages[4]]
    : channelNativeStickerUsages;
  return renderHelpBlock("channel-native stickers", usages, [
    "Use --detail to fetch enough metadata for inspection, then send with id, category, and type.",
    "--target accepts dm:<id> or group:<id>.",
  ]);
}

function renderHelpBlock(title: string, usages: string[], notes: string[]) {
  return [
    renderCliCommand(title),
    "",
    "Usage:",
    ...usages.map((usage) => `  ${renderCliCommand(`channel-native --channel zalo-personal --bot <id> ${usage}`)}`),
    "",
    "Notes:",
    ...notes.map((note) => `  - ${note}`),
  ].join("\n");
}

function requireSensitiveConfirm(args: readonly string[], action: string) {
  if (!hasFlag(args, "--confirm")) {
    throw new Error(`${action} exposes sensitive Zalo Personal state and requires --confirm.`);
  }
}

function channelNativeHelpPath(args: string[]) {
  const helpArgs = args[0] === "help" ? args.slice(1) : args;
  const messagesIndex = helpArgs.indexOf("messages");
  const stickersIndex = helpArgs.indexOf("stickers");
  if (messagesIndex === -1 && stickersIndex === -1) return [];
  if (stickersIndex !== -1 && (messagesIndex === -1 || stickersIndex < messagesIndex)) {
    return helpArgs.slice(stickersIndex).filter((arg) => !arg.startsWith("--"));
  }
  return helpArgs.slice(messagesIndex).filter((arg) => !arg.startsWith("--"));
}

export async function runChannelNativeCli(
  args: string[],
  deps: ZaloPersonalCliDependencies = defaultZaloPersonalCliDependencies,
) {
  if (!args[0] || args[0] === "help" || hasFlag(args, "--help")) {
    deps.print(renderChannelNativeHelp(channelNativeHelpPath(args)));
    return;
  }
  if (parseOptionValue(args, "--channel") !== "zalo-personal") {
    throw new Error("Only --channel zalo-personal is implemented for channel-native commands.");
  }
  const ctx = await resolveZaloPersonalCliContext(args, deps);
  const api = ctx.client.api as any;
  const messagesIndex = args.indexOf("messages");
  const stickersIndex = args.indexOf("stickers");
  if (messagesIndex !== -1) return handleMessages(args.slice(messagesIndex + 1), args, deps, ctx.client, api);
  if (stickersIndex !== -1) return handleStickers(args.slice(stickersIndex + 1), args, deps, ctx.client, api);
  throw new Error(renderChannelNativeHelp());
}

async function handleMessages(local: string[], global: string[], deps: ZaloPersonalCliDependencies, client: any, api: any) {
  const action = local[0];
  if (action === "send") return sendEnhanced(global, deps, client, api);
  if (action === "link" && local[1] === "send") return sendLink(local, global, deps, client, api);
  if (action === "video" && local[1] === "send") return sendVideo(global, deps, client, api);
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

async function sendVideo(global: string[], deps: ZaloPersonalCliDependencies, client: any, api: any) {
  const target = parseZaloPersonalTarget(parseOptionValue(global, "--target"), client);
  const file = await readAttachmentSource(parseRequiredOption(global, "--file"), deps);
  const thumbnail = await readAttachmentSource(parseRequiredOption(global, "--thumbnail"), deps);
  const result = await withZaloPersonalUploadListener(client, async () => {
    const [videoUpload, thumbnailUpload] = await Promise.all([
      api.uploadAttachment(file, target.id, target.threadType),
      api.uploadAttachment(thumbnail, target.id, target.threadType),
    ]);
    return await api.sendVideo({
      videoUrl: resolveZaloPersonalUploadedUrl(videoUpload, "video", ["fileUrl", "normalUrl"]),
      thumbnailUrl: resolveZaloPersonalUploadedUrl(thumbnailUpload, "thumbnail", ["normalUrl", "hdUrl", "thumbUrl", "fileUrl"]),
      ...(parseOptionValue(global, "--message") ? { msg: parseOptionValue(global, "--message") } : {}),
      ...(parseIntOption(global, "--duration-ms") !== undefined ? { duration: parseIntOption(global, "--duration-ms") } : {}),
      ...(parseIntOption(global, "--width") !== undefined ? { width: parseIntOption(global, "--width") } : {}),
      ...(parseIntOption(global, "--height") !== undefined ? { height: parseIntOption(global, "--height") } : {}),
      ...(parseIntOption(global, "--ttl") !== undefined ? { ttl: parseIntOption(global, "--ttl") } : {}),
    }, target.id, target.threadType);
  });
  printRaw(global, deps, result);
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
  if (action === "get") {
    requireSensitiveConfirm(global, "messages polls get");
    return printRaw(global, deps, await api.getPollDetail(Number(parseRequiredOption(global, "--poll-id"))));
  }
  if (action === "options" && local[1] === "add") return mutate(global, deps, () => api.addPollOptions({ pollId: Number(parseRequiredOption(global, "--poll-id")), options: parseRepeatedOption(global, "--option").map((content) => ({ content, voted: false })), votedOptionIds: [] }), "messages polls options add");
  if (action === "share") return mutate(global, deps, () => api.sharePoll(Number(parseRequiredOption(global, "--poll-id"))), "messages polls share");
  throw new Error(renderChannelNativeHelp());
}

async function report(global: string[], deps: ZaloPersonalCliDependencies, client: any, api: any) {
  return mutate(global, deps, () => withTarget(global, client, (target) => api.sendReport({ reason: resolveReportReason(parseRequiredOption(global, "--reason")), content: parseOptionValue(global, "--content") ?? "" }, target.id, target.threadType)), "messages report");
}

async function handleStickers(local: string[], global: string[], deps: ZaloPersonalCliDependencies, client: any, api: any) {
  const action = local[0];
  if (action === "list") return listStickers(global, deps, api);
  if (action === "search") return searchStickers(local, global, deps, api);
  if (action === "get") return printRaw(global, deps, firstStickerDetail(await api.getStickersDetail(parsePositiveInt(requireLocalPositional(local, 1, "sticker-id"), "sticker-id"))));
  if (action === "send") return sendSticker(global, deps, client, api);
  if (action === "categories" && local[1] === "get") {
    return printRaw(global, deps, await api.getStickerCategoryDetail(parsePositiveInt(requireLocalPositional(local, 2, "category-id"), "category-id")));
  }
  throw new Error(renderChannelNativeHelp(["stickers"]));
}

async function listStickers(global: string[], deps: ZaloPersonalCliDependencies, api: any) {
  const ids = (await api.getStickers(parseRequiredOption(global, "--query"))).slice(0, stickerLimit(global));
  if (!hasFlag(global, "--detail")) return printRaw(global, deps, ids);
  printRaw(global, deps, await detailStickers(api, ids));
}

async function searchStickers(local: string[], global: string[], deps: ZaloPersonalCliDependencies, api: any) {
  const results = await api.searchSticker(requireLocalPositional(local, 1, "query"), stickerLimit(global));
  if (!hasFlag(global, "--detail")) return printRaw(global, deps, results);
  const ids = results.map((item: any) => item.sticker_id).filter((id: unknown) => Number.isInteger(id));
  printRaw(global, deps, await detailStickers(api, ids));
}

async function detailStickers(api: any, ids: number[]) {
  return ids.length === 0 ? [] : api.getStickersDetail(ids);
}

function stickerLimit(global: string[]) {
  return parseIntOption(global, "--limit") ?? defaultStickerLimit;
}

async function sendSticker(global: string[], deps: ZaloPersonalCliDependencies, client: any, api: any) {
  const target = parseZaloPersonalTarget(parseOptionValue(global, "--target"), client);
  const payload = {
    id: parsePositiveInt(parseRequiredOption(global, "--id"), "--id"),
    cateId: parsePositiveInt(parseRequiredOption(global, "--category"), "--category"),
    type: parsePositiveInt(parseRequiredOption(global, "--type"), "--type"),
  };
  printRaw(global, deps, await api.sendSticker(payload, target.id, target.threadType));
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

function parsePositiveInt(raw: string, label: string) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} requires a positive integer.`);
  return value;
}

function firstStickerDetail(value: unknown) {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
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
