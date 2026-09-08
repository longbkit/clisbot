// COMPAT(clisbot-channels): the QR-login setup verbs, as the Hub calls them.
//
// A QR-auth channel has no credential to paste: the account is linked by a
// human scanning a code, the code expires, and relinking is routine
// (`packages/channels/zalouser/HUB-WIRING.md` §7). The vertical publishes five
// non-blocking verbs on `plugin.setup` and the Hub drives them from an RPC; the
// app polls.
//
// Two rules this module exists to enforce:
//
//  * The account's session store is bound BEFORE any verb runs. The account
//    lifecycle binds it too, but a profile with no session fails the start —
//    which is exactly when these verbs are used — so without `bindAccountSession`
//    a freshly scanned credential would never reach the encrypted backing.
//  * Nothing but the projected result leaves. Each verb's answer is rebuilt
//    field by field, so a vertical that ever returns session bytes cannot leak
//    them through this path.

import type { ChannelPlugin } from "../loader/load-channel.js";

/** The five operations, under the vertical's own verb names. */
export const QR_LOGIN_VERBS = ["start", "poll", "cancel", "relink", "logout"] as const;
export type QrLoginVerb = (typeof QR_LOGIN_VERBS)[number];

function isQrLoginVerb(value: string): value is QrLoginVerb {
  return (QR_LOGIN_VERBS as readonly string[]).includes(value);
}

/** Route segment → verb; the segment IS the verb name. */
export function qrLoginVerb(segment: string | undefined): QrLoginVerb | undefined {
  return segment !== undefined && isQrLoginVerb(segment) ? segment : undefined;
}

/** The `plugin.setup` member each verb calls. */
const SETUP_MEMBER: Record<QrLoginVerb, string> = {
  start: "startQrLogin",
  poll: "pollQrLogin",
  cancel: "cancelQrLogin",
  relink: "relinkQrLogin",
  logout: "logout",
};

/** The linking state the app renders. `pending` means "show the QR and poll". */
export type QrLoginStatus = "pending" | "linked" | "failed";

/** `start` / `relink` / `poll`: where the login stands. Never carries session
 * material — only what an operator has to see. */
export interface QrLoginState {
  status: QrLoginStatus;
  message: string;
  /** `data:image/png;base64,…`, present while a login is pending. */
  qrDataUrl?: string;
  /** The same code written 0600 on the daemon host, for an operator on the box. */
  qrFilePath?: string;
  /** The linked identity — confirm it is the intended account. */
  user?: { userId: string; displayName: string };
}

/** `cancel`: whether the pending code was abandoned. A still-good session is
 * never cancelled, so this is `false` more often than it looks. */
export interface QrLoginCancelled {
  cancelled: boolean;
  message: string;
}

/** `logout`: whether a stored session was cleared. */
export interface QrLoginCleared {
  cleared: boolean;
  message: string;
}

export type QrLoginResult = QrLoginState | QrLoginCancelled | QrLoginCleared;

export class QrLoginUnavailableError extends Error {}

type SetupVerbFn = (params: Record<string, unknown>) => Promise<unknown>;

function setupSurface(plugin: ChannelPlugin): Record<string, unknown> {
  const setup = plugin["setup"];
  if (typeof setup !== "object" || setup === null) {
    throw new QrLoginUnavailableError("this channel publishes no QR login");
  }
  return setup as Record<string, unknown>;
}

function verbFn(setup: Record<string, unknown>, member: string): SetupVerbFn {
  const fn = setup[member];
  if (typeof fn !== "function") {
    throw new QrLoginUnavailableError(`this channel publishes no ${member} operation`);
  }
  return fn as SetupVerbFn;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The linked identity, rebuilt from the two fields the app shows. */
function readUser(value: unknown): { userId: string; displayName: string } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const userId = optionalText(Reflect.get(value, "userId"));
  if (userId === undefined) return undefined;
  return { userId, displayName: text(Reflect.get(value, "displayName"), userId) };
}

/** `start` / `poll` / `relink`: upstream's own `{status, message, …}`. */
function readLoginResult(raw: unknown): QrLoginState {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const status = value["status"];
  const result: QrLoginState = {
    status: status === "linked" || status === "pending" ? status : "failed",
    message: text(value["message"], "the channel returned no message"),
  };
  const qrDataUrl = optionalText(value["qrDataUrl"]);
  if (qrDataUrl !== undefined) result.qrDataUrl = qrDataUrl;
  const qrFilePath = optionalText(value["qrFilePath"]);
  if (qrFilePath !== undefined) result.qrFilePath = qrFilePath;
  const user = readUser(value["user"]);
  if (user !== undefined) result.user = user;
  return result;
}

/** `cancel` / `logout`: the verb's own boolean plus upstream's message. There is
 * no login state to report — both of them END one. */
function readClearResult(raw: unknown): { flag: boolean; message: string } {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    flag: value["cancelled"] === true || value["cleared"] === true,
    message: text(value["message"], "the channel returned no message"),
  };
}

/**
 * Run one QR-login verb against a loaded vertical. `profile` is the Hub's, not
 * the caller's: it comes from the account carrier, so a request can never point
 * a verb at another account's session.
 */
export async function runQrLoginVerb(input: {
  plugin: ChannelPlugin;
  accountId: string;
  profile: string;
  verb: QrLoginVerb;
  /** The account's keyed-store durability barrier (`state/keyed-store.ts`). */
  flushState?: () => Promise<void>;
}): Promise<QrLoginResult> {
  const setup = setupSurface(input.plugin);
  const bind = setup["bindAccountSession"];
  if (typeof bind === "function") {
    await (bind as SetupVerbFn)({ accountId: input.accountId });
  }
  const answer = await verbFn(setup, SETUP_MEMBER[input.verb])({ profile: input.profile });
  // A verb writes the session through the SYNC store surface, which cannot
  // await its own write, and the encrypted backing is write-behind. Answering
  // "linked" before that reached the database meant a Hub that stopped in the
  // window came back with no session and the operator had to scan again.
  await input.flushState?.();
  if (input.verb === "cancel") {
    const { flag, message } = readClearResult(answer);
    return { cancelled: flag, message };
  }
  if (input.verb === "logout") {
    const { flag, message } = readClearResult(answer);
    return { cleared: flag, message };
  }
  return readLoginResult(answer);
}
