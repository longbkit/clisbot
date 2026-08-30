// COMPAT(clisbot-control-plane): the channel-side COMMAND layer shared by
// every channel — one parser, both channels. What OpenClaw gets right,
// applied here: ONE shared command-spec + parser, with per-channel ingress
// adapters only for what the channel cannot normalize for us.
//
//   * Slack: teams can also register NATIVE slash commands in the app
//     manifest (Socket Mode delivers `slash_commands` events). Because
//     `/approve` and `/deny` are reserved by the approval commands below,
//     the native manifest command is a single alias whose first word picks
//     the sub-command (`/paseo status`, bare `/paseo` = help). Any free
//     name the team registered works; the Slack vertical's start-account
//     reads `transport.slashCommand` and rewrites the native event to the
//     plain-text form before the plane sees it, so both spellings ride
//     this same parser. Slack ALSO accepts the backslash spelling
//     (`\approve`, `\status`): a team that already owns `/approve` for a
//     native command — or whose client blocks unregistered `/…` sends —
//     gets the same commands with zero conflict.
//   * Telegram: bots have no slash-command API for group control — commands
//     are plain text. A leading @bot mention (glued, spaced, or doubled) is
//     stripped before matching, so `@longluong3bot /status`,
//     `@longluong3bot/status`, `@bot@bot /stop`, and bare `/status` all
//     work. The Bot API's autocomplete form — a verb glued to the bot
//     username (`/approve@longluong3bot`, `/status@longluong3bot`) — is
//     normalized the same way: the `@…` rides the VERB, never the answer.
//
// The commands are IN-CONVERSATION controls (they act on the bound agent
// session), not app-level registrations — that is what makes them shareable
// across channels with zero per-channel setup.
//
// APPROVAL COMMANDS — `approve` / `deny` answer an open tool-permission
// prompt (the card's typed fallback, plus a friendlier "latest" target):
//   approve [<id>] [<answer…>]      deny [<id>]
// A bare verb answers the agent's NEWEST open prompt; an explicit id names a
// specific open prompt. Every prefix spelling (`verb`, `/verb`, `\verb`) and
// the `@bot` mention forms are accepted on both channels.

/** A parsed approval command. `requestId` absent = "latest open prompt".
 * `answer` carries the question answer (option label or "Other <free
 * text>") — question prompts only; tool-permission prompts ignore it. */
export interface ApprovalCommand {
  decision: "allow" | "deny";
  requestId?: string;
  answer?: string;
}

/** The shared text commands a channel can carry in plain text. */
export type ChannelTextCommand =
  | { name: "status" }
  | { name: "stop" }
  | { name: "new" }
  | { name: "help" };

/** The session-command verbs + the aliases users reach for (case-insensitive). */
const COMMAND_ALIASES: Record<string, ChannelTextCommand["name"]> = {
  status: "status",
  state: "status",
  stop: "stop",
  cancel: "stop",
  new: "new",
  reset: "new",
  help: "help",
};

/** Every verb the normalizer may glue a mention to (approval + session
 * commands, aliases included). */
const COMMAND_VERB_SOURCE = "approve|deny|status|state|stop|cancel|new|reset|help";

/**
 * Normalize the mention/gluing forms a channel client can prepend or attach
 * to a command verb:
 *
 *   * A leading Telegram-style @bot mention — `@username` (3–32 word chars:
 *     real usernames are `[a-zA-Z0-9_]{5,32}`; the floor is lowered to 3 so
 *     short test handles like `@bot` normalize too) followed by
 *     punctuation/slashes/whitespace, up to twice (doubled mentions happen
 *     when a user re-addresses the bot). The
 *     `@` is required, so a plain word at the start of an ordinary sentence
 *     is never swallowed, and only a LEADING mention before a KNOWN verb is
 *     stripped — "hello @someone" and prose stay untouched.
 *   * The Telegram autocomplete suffix — a `@username` glued directly to the
 *     verb (`/approve@longluong3bot`). Stripping it keeps the rest of the
 *     line (the id, the answer) exactly where the parser expects it.
 *
 * The prefix itself (`/`, `\`, or none) is left for the verb regexes to
 * match — this function only removes mentions.
 */
const MENTION_BEFORE_COMMAND = new RegExp(
  `^(?:[\\s/\\\\.,!@]*@\\w{3,32})+\\s*(?:[/\\\\]+\\s*)?(?=(?:${COMMAND_VERB_SOURCE})\\b)`,
  "iu",
);

/** A `@username` glued directly to a known verb (Telegram's
 * `/command@botname` autocomplete form) — the slash/backslash prefix, when
 * present, is part of the glued token. */
const MENTION_AFTER_VERB = new RegExp(`^[/\\\\]?(${COMMAND_VERB_SOURCE})@\\w{3,32}`, "iu");

/** A Slack native user/bot mention token (`<@U…>`, `<@!B…>`) — Slack's
 * equivalent of Telegram's `@botname` addressing. Rewritten to the `@handle`
 * form so the mention regexes below match it unchanged. */
const SLACK_MENTION_TOKEN = /<@!?[A-Z][A-Z0-9]{2,31}>/giu;

function stripMentions(text: string): string {
  // Slack first: `<@U8Z…> /approve` is how a Slack user addresses the bot.
  let normalized = text.replace(SLACK_MENTION_TOKEN, (token) => `@${token.slice(2, -1)}`);
  // Up to two leading mentions ("@bot @bot /approve" is the realistic max).
  for (let i = 0; i < 2; i += 1) {
    const match = MENTION_BEFORE_COMMAND.exec(normalized);
    if (match === null) break;
    normalized = normalized.slice(match[0].length);
  }
  // The glued verb suffix: `/approve@bot` → `/approve` (prefix kept).
  const trimmedStart = normalized.trimStart();
  const lead = normalized.length - trimmedStart.length;
  const suffix = MENTION_AFTER_VERB.exec(trimmedStart);
  if (suffix !== null) {
    // Drop the glued `@username` (everything from the `@` to the match end),
    // keeping the prefix + verb — the autocomplete form; a spaced "@bot"
    // after a verb is prose and never matches here.
    const at = suffix[0].indexOf("@");
    normalized = normalized.slice(0, lead + at) + normalized.slice(lead + suffix[0].length);
  }
  return normalized;
}

/**
 * Parse an approval command out of one inbound message; null for any other
 * text. The remainder after the id (or after a bare verb) is the question's
 * free-text answer, so option labels with spaces survive. Trailing
 * punctuation Telegram clients sometimes append (`.`, `!`) is trimmed off
 * the id.
 */
export function parseApprovalCommand(text: string): ApprovalCommand | null {
  const normalized = stripMentions(text);
  const match =
    /^\s*(?:[/\\]+)?(approve|deny)\b(?:\s+([A-Za-z0-9][A-Za-z0-9._-]*))?(?:\s+(.*))?$/is.exec(
      normalized,
    );
  if (match === null) return null;
  const decision = match[1] === "approve" ? "allow" : "deny";
  let requestId = match[2] !== undefined ? match[2].replace(/[.,!]+$/u, "") : undefined;
  if (requestId === "") requestId = undefined;
  const answer = (match[3] ?? "").trim();
  // The second token must be id-shaped or answer-shaped (starts with a word
  // character): "approve !bad-id!" is junk, not a free-text answer to a
  // prompt nobody named, and stays inert.
  if (match[2] === undefined && answer !== "" && !/^\w/u.test(answer)) return null;
  if (
    requestId !== undefined &&
    answer !== "" &&
    /^(?:a|an|me|my|that|the|this)$/iu.test(requestId)
  )
    return null;
  return {
    decision,
    ...(requestId !== undefined ? { requestId } : {}),
    ...(answer !== "" ? { answer } : {}),
  };
}

/**
 * Parse a shared session text command out of one inbound message; null for
 * any other text. The slash is optional (bare `status` in a bound
 * conversation is a command too) and the backslash spelling is accepted (the
 * Slack conflict-free form); only a whole-message match, never a mid-sentence
 * word.
 */
export function parseChannelTextCommand(text: string): ChannelTextCommand | null {
  const normalized = stripMentions(text);
  const match = /^\s*[/\\]?\s*([a-z]+)\s*$/i.exec(normalized);
  if (match === null || match[1] === undefined) return null;
  const name = COMMAND_ALIASES[match[1].toLowerCase()];
  return name !== undefined ? { name } : null;
}

/** The help text a channel posts for /help: the shared command list. */
export function textCommandHelpText(): string {
  return [
    "Commands:",
    "- `/status` — agent + session state",
    "- `/stop` — stop the running turn",
    "- `/new` — start a fresh session in this conversation",
    "- `/help` — this list",
    "Approvals: `/approve` or `/deny` answers the newest prompt; `/approve <id>` names one.",
    "Slack: if `/…` collides with a native command, use the backslash form — `\\approve`, `\\status`.",
  ].join("\n");
}
