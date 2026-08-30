// COMPAT(clisbot-control-plane): the native approval-card surface (the
// 2026-08-27 decision in docs/audits/2026-08-24-hub-integration-implementation.md):
// one shared prompt-wording builder (text mode and card mode must never drift),
// the per-channel native card payloads (Slack Block Kit `blocks`, Telegram
// inline-keyboard `reply_markup`), the decided-state one-liner the in-place
// update posts, and the `inlineButtons` placement gate. Pure + channel-open-
// typed: the Hub package keeps zero `@getpaseo/channels-*` imports, so the
// card payloads are plain records the verticals' send adapters understand,
// and the channel wire envelopes (the Slack `block_actions` payload) are
// parsed in the vertical — the hub owns only the card-value scheme.
import type { AgentPermissionRequest } from "../daemon/types.js";

// --- Question prompts (E5: AskUserQuestion) ----------------------------------

/** One AskUserQuestion option as it reaches the card (label + description). */
export interface QuestionOption {
  label: string;
  description?: string;
}

/** One question of an AskUserQuestion prompt. */
export interface QuestionInfo {
  /** The full question text — the key `updatedInput.answers` must use. */
  text: string;
  options: QuestionOption[];
  /** Always offered: free-text answer ("Other"). */
  allowOther: boolean;
}

function isQuestionOptionsArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Extract the AskUserQuestion shape from a `permission_requested` input
 * (daemon `resolvePermissionKind` already flagged `kind: "question"`; this is
 * the renderer's view of `input.questions`). Options may be plain strings or
 * `{label, description}` objects — both are normalized here, once.
 */
export function questionInfoFromRequest(
  request: AgentPermissionRequest,
): QuestionInfo[] | undefined {
  if (request.kind !== "question") return undefined;
  const input = request.input;
  const questions = input?.["questions"];
  if (!Array.isArray(questions) || questions.length === 0) return undefined;
  const out: QuestionInfo[] = [];
  for (const entry of questions) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const text = typeof record["question"] === "string" ? record["question"] : "";
    if (text === "") continue;
    const options = normalizeQuestionOptions(record["options"]);
    if (options.length === 0) continue;
    out.push({
      text,
      options,
      // The daemon adds `allowOther` to every AskUserQuestion input; default to
      // offering it when the field is absent (a card with no free-text path
      // would be a dead end for a "none of these" answer).
      allowOther: record["allowOther"] !== false,
    });
  }
  return out.length > 0 ? out : undefined;
}

/** One question's `options` field → normalized `QuestionOption[]` (string or
 * `{label, description}` entries; invalid entries dropped). */
function normalizeQuestionOptions(rawOptions: unknown): QuestionOption[] {
  if (!isQuestionOptionsArray(rawOptions)) return [];
  const out: QuestionOption[] = [];
  for (const option of rawOptions) {
    if (typeof option === "string") {
      if (option !== "") out.push({ label: option });
      continue;
    }
    if (typeof option !== "object" || option === null) continue;
    const record = option as Record<string, unknown>;
    const label = record["label"];
    if (typeof label !== "string" || label === "") continue;
    const description = record["description"];
    out.push({
      label,
      ...(typeof description === "string" && description !== "" ? { description } : {}),
    });
  }
  return out;
}

// --- The shared prompt wording (one builder, both modes) ----------------------

/**
 * The stable card id: the daemon's request id, verbatim. ONE id serves both
 * native payloads AND the typed command — a card click, a card button, and
 * `approve <id>` all carry it, and the open-prompt map is keyed on it (no
 * truncation, no second lookup: the id is the id). A request id is a 36-char
 * UUID: inside Slack's 2000-char `value` and Telegram's 64-char
 * `callback_data` for tool cards (`allow:<id>` = 42); question-option values
 * that would exceed the Telegram limit are dropped at build time (the typed
 * command still answers them).
 */
export function cardIdFor(request: AgentPermissionRequest): string {
  return request.id;
}

/** The one-line "how to answer by typing" the prompt text always carries —
 * the id in it is the id the answer command uses, in BOTH modes (E1: a card
 * post without the typed command is a dead end when the buttons fail to
 * render). Slash-style (works in Slack and Telegram; a leading @bot mention
 * is tolerated — see `command.ts`), latest-first: the bare form answers this
 * prompt when it is the agent's newest open one, the explicit id form works
 * whenever. Question prompts get the `<option>` suffix form; a multi-question
 * prompt adds the `q<i>` targeting line. */
/** A UUID anywhere in the id (the daemon mints `permission-exec-<uuid>` —
 * the leading words are a CLASS label, identical across prompts). */
const UUID_IN_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;

/** The short id the typed command shows: the first 8 chars of the id's UUID
 * (the random part — the first 8 chars of the RAW id would be the shared
 * `permission-…` class prefix, which is never unique), else the first 8
 * chars. The answer resolvers match it directly or as a UNIQUE PREFIX of the
 * full id, so users never have to read or type a 36-char UUID — the full id
 * still works verbatim. */
export function shortIdOf(id: string): string {
  const uuid = UUID_IN_ID.exec(id);
  return (uuid !== null ? uuid[0] : id).slice(0, 8);
}

export function shortIdFor(request: AgentPermissionRequest): string {
  return shortIdOf(request.id);
}

const TOOL_LABELS: Record<string, string> = {
  Bash: "Bash",
  CodexBash: "Bash",
  CodexApply: "File changes",
  CodexFileChange: "File changes",
};

export function toolLabelFor(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

export function answerCommandLine(
  request: AgentPermissionRequest,
  isQuestion: boolean,
  questionCount = 0,
): string {
  const id = shortIdFor(request);
  if (!isQuestion)
    return `Type \`/approve\` to allow, \`/deny\` to refuse — or name this one directly: \`/approve ${id}\`. On Slack a backslash works too: \`\\approve\`.`;
  const line = `Type \`/approve <option>\` to answer (option label, or \`Other\` + your text) — or \`/deny\` to dismiss. This prompt: \`/approve ${id} <option>\`.`;
  if (questionCount <= 1) return line;
  return `${line} This prompt has ${questionCount} questions: prefix the answer with \`q<i>\` (1-based) to target question <i> — \`q1\` is the default, so a bare answer or a card button answers question 1.`;
}

/** The question block of the prompt text: the question + EVERY option (label +
 * description) + Other (E5: not the generic tool-permission wording). */
export function questionPromptLines(question: QuestionInfo): string[] {
  const lines = [question.text];
  for (const [index, option] of question.options.entries()) {
    lines.push(
      `${index + 1}. **${option.label}**${
        option.description !== undefined ? ` — ${option.description}` : ""
      }`,
    );
  }
  if (question.allowOther)
    lines.push(`${question.options.length + 1}. **Other** (type your own answer)`);
  return lines;
}

/** A short, human summary of WHAT the pending tool call will do — the
 * one-liner that makes an approval prompt recognizable without the raw
 * request id. Bash-style tools lead with the command; file-change tools with
 * the file(s); everything else falls back to the daemon's description/title.
 * Capped so a prompt line stays scannable. */
export function toolActionSummary(request: AgentPermissionRequest): string | undefined {
  const input = request.input ?? {};
  const command = input["command"];
  if (typeof command === "string" && command.trim() !== "") return capCommand(command.trim());
  const detail = request.detail;
  if (detail !== undefined) {
    const detailInput = detail["input"];
    if (typeof detailInput === "object" && detailInput !== null) {
      const detailCommand = (detailInput as Record<string, unknown>)["command"];
      if (typeof detailCommand === "string" && detailCommand.trim() !== "") {
        return capCommand(detailCommand.trim());
      }
    }
  }
  if (typeof request.title === "string" && request.title.trim() !== "") {
    return cap(request.title.trim());
  }
  if (typeof request.description === "string" && request.description.trim() !== "") {
    return cap(request.description.trim());
  }
  return undefined;
}

const SUMMARY_MAX_CHARS = 160;
const COMMAND_MAX_CHARS = 2000;

function cap(text: string): string {
  const single = text.replace(/\s+/gu, " ");
  if (single.length <= SUMMARY_MAX_CHARS) return single;
  return `${single.slice(0, SUMMARY_MAX_CHARS - 1)}…`;
}

function capCommand(text: string): string {
  if (text.length <= COMMAND_MAX_CHARS) return text;
  return `${text.slice(0, COMMAND_MAX_CHARS - 19)}… [command truncated]`;
}

function inlineSummary(text: string): string {
  return cap(text);
}

function workingDirectory(request: AgentPermissionRequest): string | undefined {
  const cwd = request.input?.["cwd"];
  return typeof cwd === "string" && cwd.trim() !== "" ? cwd.trim() : undefined;
}

/** The in-thread prompt text — the SINGLE wording source for both text mode
 * and the card's section text (DRY: the card never re-renders its own copy). */
export function promptText(
  request: AgentPermissionRequest,
  initiatorOnly: boolean,
  questions?: QuestionInfo[],
): string {
  const summary = toolActionSummary(request);
  const lines: string[] = [
    ...(questions !== undefined
      ? [
          `❓ The agent has a question (${request.name}):`,
          ...questions.flatMap((question) => questionPromptLines(question)),
        ]
      : [
          `⏸️ **${toolLabelFor(request.name)}** wants to run:`,
          ...(summary !== undefined
            ? [
                summary.includes("\n") || summary.length > SUMMARY_MAX_CHARS
                  ? `\`\`\`\n${summary}\n\`\`\``
                  : `\`${summary}\``,
              ]
            : []),
          ...(workingDirectory(request) !== undefined ? [`in ${workingDirectory(request)}`] : []),
          ...(request.description !== undefined && summary !== request.description.trim()
            ? [request.description]
            : []),
        ]),
    answerCommandLine(request, questions !== undefined, questions?.length ?? 0),
    ...(initiatorOnly
      ? ["Only the person who started this thread can answer."]
      : ["Anyone with approval rights for this tool class can answer."]),
  ];
  return lines.join("\n");
}

// --- Native card payloads ------------------------------------------------------

/** A card button the two verticals render (Slack `actions` / Telegram
 * inline keyboard row). `value` carries what the resolver needs on the way
 * back: `<decision>:<cardId>` plus, for question answers, the chosen
 * option ("Other" free-text rides the text command, not a button). */
export interface CardButton {
  text: string;
  value: string;
  style?: "primary" | "danger";
}

export function buttonValue(decision: "allow" | "deny", cardId: string, answer?: string): string {
  return answer !== undefined ? `allow:${cardId}:${answer}` : `${decision}:${cardId}`;
}

/** The free-text answer marker ("Other") — what a card button's value carries
 * when the responder picks "Other"; the free text itself rides the typed
 * command (`approve <id> Other <text>`). */
export const OTHER_ANSWER = "Other";

/** Parse a button's `value` back into the resolver's input. Null for a value
 * the card did not mint (a stale or foreign callback). The answer is
 * everything after the second `:` — option labels may contain colons. */
export function parseCardValue(value: string): {
  decision: "allow" | "deny";
  cardId: string;
  answer?: string;
} | null {
  const parts = value.split(":");
  const [decision, cardId] = [parts[0], parts[1]];
  if (decision !== "allow" && decision !== "deny") return null;
  if (cardId === undefined || cardId === "") return null;
  const answer = parts.slice(2).join(":");
  return {
    decision,
    cardId,
    ...(answer !== "" ? { answer } : {}),
  };
}

/** The tool-permission card's buttons: approve / deny. */
export function permissionCardButtons(request: AgentPermissionRequest): CardButton[] {
  const cardId = cardIdFor(request);
  return [
    { text: "Approve", value: buttonValue("allow", cardId), style: "primary" },
    { text: "Deny", value: buttonValue("deny", cardId), style: "danger" },
  ];
}

/** The Bot API `callback_data` limit (64 chars): a button whose value would
 * exceed it is dropped (its option stays answerable by the typed command). */
export const TELEGRAM_CALLBACK_DATA_LIMIT = 64;

/** The question card's buttons: one per option + Other (E5). "Other" carries
 * the free-text marker as its value — the free text itself rides the typed
 * command. An option label whose `callback_data` value would exceed the Bot
 * API limit is dropped (fail closed: the typed command still answers it). */
export function questionCardButtons(
  request: AgentPermissionRequest,
  questions: QuestionInfo[],
  valueLimit: number = Infinity,
): CardButton[] {
  const cardId = cardIdFor(request);
  const buttons: CardButton[] = [];
  for (const question of questions) {
    for (const option of question.options) {
      const value = buttonValue("allow", cardId, option.label);
      if (value.length > valueLimit) continue;
      buttons.push({ text: option.label, value });
    }
    if (question.allowOther)
      buttons.push({ text: "Other…", value: buttonValue("allow", cardId, OTHER_ANSWER) });
  }
  buttons.push({ text: "Dismiss", value: buttonValue("deny", cardId), style: "danger" });
  return buttons;
}

/** The action-id prefix the Slack card's buttons carry (a Block Kit button
 * has no `callback_id` of its own; the id tags the card's actions block).
 * Slack REQUIRES a unique `action_id` per element within a block, so each
 * button's id is suffixed with its index (see `buildSlackCardBlocks`). Card
 * OWNERSHIP is the card VALUE, not the action id — the vertical forwards
 * every `block_actions` click it parses, and the hub's `parseCardValue`
 * returns null for a value this card did not mint (a stray interactivity is
 * inert). The vertical never checks `action_id`, so the suffix can change
 * freely. */
export const SLACK_APPROVAL_ACTION_ID = "approval_action";

/** The all-buttons set of a prompt (the Slack card's actions block / the
 * Telegram keyboard's rows — one button per row, the Telegram limit). */
export function cardButtonsFor(
  request: AgentPermissionRequest,
  questions?: QuestionInfo[],
  valueLimit: number = Infinity,
): CardButton[] {
  return questions !== undefined
    ? questionCardButtons(request, questions, valueLimit)
    : permissionCardButtons(request);
}

/** Slack Block Kit payload: a section (the shared prompt wording) + an
 * actions block with the card's buttons. Open-typed (the Hub never imports the
 * Slack SDK types); the vertical's send adapter posts it verbatim. */
export function buildSlackCardBlocks(
  request: AgentPermissionRequest,
  initiatorOnly: boolean,
  questions?: QuestionInfo[],
): Record<string, unknown>[] {
  // Slack Block Kit rejects a block whose elements share an `action_id`
  // (`invalid_blocks: action_id "..." already exists`), so each button's id
  // is suffixed with its index. The id is cosmetic here — the click's
  // ownership rides the `value`, which the vertical forwards verbatim.
  const actions: Record<string, unknown>[] = cardButtonsFor(request, questions).map(
    (button, index) => {
      const block: Record<string, unknown> = {
        type: "button",
        text: { type: "plain_text", text: button.text, emoji: true },
        action_id: `${SLACK_APPROVAL_ACTION_ID}_${index + 1}`,
        value: button.value,
      };
      if (button.style !== undefined) block["style"] = button.style;
      return block;
    },
  );
  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: promptText(request, initiatorOnly, questions) },
    },
    ...(actions.length > 0 ? [{ type: "actions", elements: actions }] : []),
  ];
}

/** Telegram `reply_markup` payload: an inline keyboard, one button per row
 * (the Bot API's practical button limit per row). */
export function buildTelegramReplyKeyboard(
  request: AgentPermissionRequest,
  questions?: QuestionInfo[],
): Record<string, unknown> {
  // The Bot API caps `callback_data` at 64 chars — question options whose
  // value would exceed it are dropped here (the typed command still answers
  // them), so no button is ever minted non-postable.
  const rows = cardButtonsFor(request, questions, TELEGRAM_CALLBACK_DATA_LIMIT).map((button) => [
    { text: button.text, callback_data: button.value },
  ]);
  return { inline_keyboard: rows };
}

/**
 * Resolve a typed/card answer into the `updatedInput.answers` entry the
 * daemon expects — keyed by the FULL question text (the daemon's
 * `normalizeClaudeAskUserQuestionUpdatedInput` reads by question text). An
 * option label matches case-insensitively (the canonical label is what goes
 * to the daemon); "Other" takes the free text that follows it.
 *
 * Multi-question P0 rule: a `q<i>` (1-based) prefix targets question <i>;
 * a bare answer (or a card button) targets question 1 — the prompt's
 * multi-question line tells the user the prefix exists. Null when the answer
 * is not actionable (no answer, bare "Other", unknown option, out-of-range
 * target, or the target question has no Other).
 */
export function resolveQuestionAnswer(
  questions: QuestionInfo[],
  answer: string | undefined,
): { questionText: string; value: string } | null {
  const given = answer?.trim() ?? "";
  if (given === "") return null;
  const target = /^q(\d+)\s+(.+)$/iu.exec(given);
  const rest = target !== null && typeof target[2] === "string" ? target[2].trim() : given;
  const index =
    target !== null && typeof target[1] === "string" ? Number.parseInt(target[1], 10) - 1 : 0;
  const question = questions[index];
  if (question === undefined) return null;
  const option = question.options.find(
    (candidate) => candidate.label.toLowerCase() === rest.toLowerCase(),
  );
  if (option !== undefined) return { questionText: question.text, value: option.label };
  // "Other <free text>" — the free-text answer form (E5).
  const other = /^other\b\s*(.+)$/iu.exec(rest);
  const freeText = other !== null && typeof other[1] === "string" ? other[1].trim() : "";
  if (freeText === "") return null;
  return question.allowOther ? { questionText: question.text, value: freeText } : null;
}

// --- The decided-state one-liner (in-place update) ------------------------------

/** The short result text the in-place `chat.updateMessage` / `editMessageText`
 * posts when the prompt resolves (E1: the card updates in place, it does not
 * re-post the outcome). Friendly by design: no raw request id in the main
 * line — the id is the card value / command arg, not something a human needs
 * to read; `responder` is the sender's display name when the channel
 * supplied one, else the channel-native identity. */
export function decidedPromptText(params: {
  request: AgentPermissionRequest;
  questions: QuestionInfo[] | undefined;
  decision: "allow" | "deny";
  answer?: string;
  responder: string;
  /** Reserved: true when the prompt was answered through a native card
   * (buttons) rather than a typed command. The decided line no longer
   * branches on it (it never prints a type-back id since short ids). */
  cardMode?: boolean;
}): string {
  const { request, questions, decision, answer, responder } = params;
  // An empty responder = the channel tags the person natively (Slack's
  // `<@USERID>` mention, prepended by the update) — no "by …" clause.
  const safeResponder =
    responder !== "" && !/^[a-z][a-z0-9_-]*:.+$/iu.test(responder) ? responder : "";
  const by = safeResponder === "" ? "" : ` — by ${safeResponder}`;
  const summary = toolActionSummary(request);
  const label = toolLabelFor(request.name);
  const what = summary !== undefined ? `${label} \`${inlineSummary(summary)}\`` : label;
  if (decision === "deny") {
    const main =
      questions !== undefined ? `❌ Dismissed the ${label} question` : `❌ Denied ${what}`;
    return `${main}${by}.`;
  }
  if (questions !== undefined && answer !== undefined) {
    return `✅ Answered the ${label} question: ${answer}${by}.`;
  }
  return `✅ Approved ${what}${by}.`;
}

// --- The `inlineButtons` placement gate (E1: where a card may appear) -----------

/** The prompt's conversation surface: `dm` or a group surface (channels,
 * groups, topics — the `dm|group` gate's "group" side). */
export type PromptSurfaceKind = "dm" | "group";

/** The `transport.inlineButtons` value (open-typed config record → guard). */
export type InlineButtonsMode = "off" | "dm" | "group" | "all" | "allowlist";

const INLINE_BUTTONS_MODES: readonly InlineButtonsMode[] = [
  "off",
  "dm",
  "group",
  "all",
  "allowlist",
];

/** True when a config record's `inlineButtons` value is a known mode. */
export function isInlineButtonsMode(value: unknown): value is InlineButtonsMode {
  return typeof value === "string" && (INLINE_BUTTONS_MODES as readonly string[]).includes(value);
}

/**
 * May a native card appear at this surface under this account's
 * `transport.inlineButtons`? `off` (the default, absent = off) keeps the text
 * + command prompt; `allowlist` behaves as off at P0 (the companion list key
 * does not exist in the schema yet — fail closed).
 */
export function inlineButtonsAllowedFor(
  mode: "off" | "dm" | "group" | "all" | "allowlist" | undefined,
  surface: PromptSurfaceKind,
): boolean {
  switch (mode) {
    case "all":
      return true;
    case "dm":
      return surface === "dm";
    case "group":
      return surface === "group";
    case "off":
    case "allowlist":
    case undefined:
      return false;
  }
}

/** The surface kind a prompt's binding root resolves to: a `dm` root is the
 * DM surface; channel/group roots (and anything threaded/topic on them) are
 * group surfaces. The root kind comes from the binding's stored route
 * summary (thread → channel, topic → group, already mapped at store time). */
export function promptSurfaceKind(rootKind: string): PromptSurfaceKind {
  return rootKind === "dm" ? "dm" : "group";
}
