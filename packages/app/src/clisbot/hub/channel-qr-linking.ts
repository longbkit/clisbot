/**
 * The QR-login renderer model for Zalo Personal.
 *
 * The five verbs (`startQrLogin`, `pollQrLogin`, `cancelQrLogin`,
 * `relinkQrLogin`, `logout`) are non-blocking and the app polls, so the screen
 * needs a state machine rather than a promise chain — this is it, and it holds
 * no React and no transport. `packages/channels/zalouser/HUB-WIRING.md` §7 is the
 * contract it is written against.
 *
 * `unavailable` is the terminal phase for "this Hub cannot do this": a build
 * whose Hub predates the QR operations answers every verb with the management
 * API's unknown-route 404. The phase offers no action, because there is nothing
 * the operator can do here but upgrade the Hub. A 503 is different — the channel
 * runtime is down right now — so it settles as an ordinary failure and leaves
 * the action offered.
 *
 * Two facts the wire cannot tell you, both from §7: the QR expires after about
 * three minutes, and a `failed` result whose message is about expiry means
 * "generate a new one", not "something is broken".
 */

export const CHANNEL_QR_TTL_MS = 180_000;

export type ChannelQrPhase =
  | "unavailable"
  | "idle"
  | "starting"
  | "pending"
  | "linked"
  | "expired"
  | "failed";

export type ChannelQrAction = "start" | "relink" | "cancel" | "logout";

export interface ChannelQrUser {
  userId: string;
  displayName: string | null;
}

export interface ChannelQrStartResult {
  status: "pending" | "linked" | "failed";
  qrDataUrl?: string | undefined;
  qrFilePath?: string | undefined;
  message: string;
}

export interface ChannelQrPollResult {
  status: "pending" | "linked" | "failed";
  message: string;
  user?: ChannelQrUser | undefined;
}

export interface ChannelQrState {
  phase: ChannelQrPhase;
  /** `data:image/png;base64,…`, present only while a scan is pending. */
  qrDataUrl: string | null;
  /** A 0600 file on the daemon host; useful only to an operator on that box. */
  qrFilePath: string | null;
  message: string | null;
  user: ChannelQrUser | null;
  /** A poll is in flight. The QR stays on screen while it is. */
  polling: boolean;
  /** A verb other than poll is in flight; every action is suppressed. */
  busy: boolean;
  expiresAt: number | null;
  remainingMs: number | null;
  actions: readonly ChannelQrAction[];
}

export interface ChannelQrModel {
  getState(): ChannelQrState;
  subscribe(listener: () => void): () => void;
  close(): void;
  /** A start or relink request left the app. */
  begin(verb: "start" | "relink" | "cancel" | "logout"): void;
  applyStart(result: ChannelQrStartResult, now?: number): void;
  beginPoll(): void;
  applyPoll(result: ChannelQrPollResult): void;
  applyCancel(result: { cancelled: boolean; message: string }): void;
  applyLogout(result: { cleared: boolean; message: string }): void;
  /** A verb's rejection: terminal for the panel, or an ordinary failure. */
  fail(failure: ChannelQrFailure): void;
  tick(now: number): void;
}

const ACTIONS: Readonly<Record<ChannelQrPhase, readonly ChannelQrAction[]>> = {
  unavailable: [],
  idle: ["start"],
  starting: [],
  pending: ["cancel"],
  linked: ["relink", "logout"],
  expired: ["start"],
  failed: ["start"],
};

/** §7: an expiry is routine and its recovery is a new code, not a retry. */
export function isChannelQrExpiryMessage(message: string): boolean {
  return /expir/iu.test(message);
}

export interface ChannelQrFailure {
  /** The Hub serves no QR operations; no retry from this panel can change that. */
  unavailable: boolean;
  message: string;
}

/** How a verb's rejection is settled. Only the unknown-route 404 is terminal. */
export function channelQrFailure(problem: { status: number; message: string }): ChannelQrFailure {
  if (problem.status === 404) {
    return {
      unavailable: true,
      message:
        "This Hub does not serve QR linking for this channel. Update the Hub, then link the account here.",
    };
  }
  if (problem.status === 503) {
    return {
      unavailable: false,
      message: `${problem.message} The channel runtime has to be running to link an account.`,
    };
  }
  return { unavailable: false, message: problem.message };
}

export function openChannelQrLinking(input: { available: boolean }): ChannelQrModel {
  let phase: ChannelQrPhase = input.available ? "idle" : "unavailable";
  let qrDataUrl: string | null = null;
  let qrFilePath: string | null = null;
  let message: string | null = input.available
    ? null
    : "This Hub does not serve QR linking for this channel.";
  let user: ChannelQrUser | null = null;
  let polling = false;
  let busy = false;
  let expiresAt: number | null = null;
  let now = 0;
  const listeners = new Set<() => void>();
  let state = build();

  function build(): ChannelQrState {
    return {
      phase,
      qrDataUrl,
      qrFilePath,
      message,
      user,
      polling,
      busy,
      expiresAt,
      remainingMs: expiresAt === null ? null : Math.max(0, expiresAt - now),
      actions: busy ? [] : ACTIONS[phase],
    };
  }

  function publish(): void {
    state = build();
    for (const listener of listeners) listener();
  }

  function clearCode(): void {
    qrDataUrl = null;
    qrFilePath = null;
    expiresAt = null;
    polling = false;
  }

  function settleFailure(text: string): void {
    clearCode();
    phase = isChannelQrExpiryMessage(text) ? "expired" : "failed";
    message = text;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      listeners.clear();
    },
    begin(verb) {
      if (phase === "unavailable") return;
      busy = true;
      message = null;
      if (verb === "start" || verb === "relink") {
        phase = "starting";
        clearCode();
        user = null;
      }
      publish();
    },
    applyStart(result, at = now) {
      if (phase === "unavailable") return;
      busy = false;
      now = at;
      message = result.message;
      if (result.status === "pending") {
        phase = "pending";
        qrDataUrl = result.qrDataUrl ?? null;
        qrFilePath = result.qrFilePath ?? null;
        expiresAt = at + CHANNEL_QR_TTL_MS;
        polling = false;
        publish();
        return;
      }
      if (result.status === "linked") {
        clearCode();
        phase = "linked";
        publish();
        return;
      }
      settleFailure(result.message);
      publish();
    },
    beginPoll() {
      if (phase !== "pending" || polling || busy) return;
      polling = true;
      publish();
    },
    applyPoll(result) {
      if (phase !== "pending") return;
      polling = false;
      message = result.message;
      if (result.status === "linked") {
        clearCode();
        phase = "linked";
        user = result.user ?? null;
        publish();
        return;
      }
      if (result.status === "failed") settleFailure(result.message);
      publish();
    },
    applyCancel(result) {
      busy = false;
      message = result.message;
      if (result.cancelled) {
        clearCode();
        phase = "idle";
      }
      publish();
    },
    applyLogout(result) {
      busy = false;
      message = result.message;
      if (result.cleared) {
        clearCode();
        user = null;
        phase = "idle";
      }
      publish();
    },
    fail(failure) {
      if (phase === "unavailable") return;
      busy = false;
      if (failure.unavailable) {
        clearCode();
        phase = "unavailable";
        message = failure.message;
      } else settleFailure(failure.message);
      publish();
    },
    tick(at) {
      now = at;
      if (phase === "pending" && expiresAt !== null && at >= expiresAt) {
        clearCode();
        phase = "expired";
        message = "The QR code expired. Generate a new one.";
      }
      publish();
    },
  };
}

/** The renderer's poll gate: poll only while a code is on screen and idle. */
export function shouldPollChannelQr(state: ChannelQrState): boolean {
  return state.phase === "pending" && !state.polling && !state.busy;
}

export const CHANNEL_QR_ACTION_LABELS: Readonly<Record<ChannelQrAction, string>> = {
  start: "Show QR code",
  relink: "Link a different account",
  cancel: "Cancel",
  logout: "Unlink",
};
