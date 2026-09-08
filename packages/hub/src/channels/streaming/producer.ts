// The Hub-side streaming producer (goal ledger slice 22b): the agent turn's
// assistant text and tool activity, driven onto the channel WHILE the turn
// runs, instead of only as one final post.
//
// One draft per assistant message. The relay keeps ownership of the delivery
// ledger and of what a route is allowed to say; this producer only decides how
// the text gets there:
//
//   first delta  → start the draft (native stream, else a posted message)
//   later deltas → append / edit in place, paced by the channel's limits
//   message ends → the relay records ONE ledger row and calls this producer's
//                  finalize transport, which finishes the draft in place
//
// Everything degrades to a plain post: no drivable primitives, mode `off`, or
// any streaming call that throws all end with the relay posting the full reply
// once, on one row. An answer that outgrows the platform's text cap is not a
// failure — the draft becomes the answer's FIRST message and the rest posts
// after it, so a long reply never leaves an abandoned draft beside itself.
//
// One draft drives ONE channel call at a time. The daemon coalesces assistant
// text on a 60 ms window and the supervisor dispatches each stream event
// without awaiting the previous one, so deltas routinely overtake a channel
// round-trip (D-W4-03).
import type { StreamContext } from "../plane/types.js";
import type { OutboundPostParams, PlaneClock, PlaneLogger, PostFn } from "../plane/types.js";
import type {
  ChannelProgressLine,
  ChannelStreamingDriver,
  ChannelStreamingMode,
  StreamingDraftTarget,
  StreamingFinalizeTransport,
} from "./types.js";

/** One assistant message's live draft. */
interface DraftState {
  target: StreamingDraftTarget;
  /** Text the channel already shows. */
  rendered: string;
  /** The native stream handle, when the draft runs on the native transport. */
  session?: unknown;
  /** The draft message's native id, when the draft runs on edit-in-place. */
  messageId?: string;
  lastPushAt: number;
  /**
   * Why the draft stopped taking pushes; `undefined` while it is live.
   *
   * `capped` — the answer outgrew the channel's text cap. Everything the draft
   * shows was delivered, so finalize keeps it as the answer's first message.
   * `failed` — a streaming call was refused. Nothing the draft shows can be
   * trusted, so finalize hands the whole answer back to the plain post path.
   */
  closed?: "capped" | "failed" | undefined;
  /**
   * The draft's in-flight channel call, or `undefined` when it is idle. A
   * delta that arrives while a call is on the wire is dropped: the next one
   * carries a superset of its text, and driving two calls at once is how the
   * draft used to lose its message id mid-post and break for the whole turn.
   */
  inFlight?: Promise<void> | undefined;
}

/** The turn's progress message (`streaming.mode: progress`). */
interface ProgressState {
  target: StreamingDraftTarget;
  messageId?: string;
  lines: ChannelProgressLine[];
  lastPushAt: number;
  /** The progress message's in-flight channel call, or `undefined` when it is
   * idle. Same rule as a draft's: the first event's POST is on the wire before
   * it has an id, so an event that arrives during it would post a second
   * progress message instead of editing the first. */
  inFlight?: Promise<void> | undefined;
}

export interface StreamingProducerDeps {
  logger: PlaneLogger;
  clock: PlaneClock;
  driver: ChannelStreamingDriver;
  /** The plain post path — the draft's first message and every fallback. */
  post: PostFn;
}

/** The scope key a draft is held under: the agent plus the relay's turn key
 * (root turn id or `sub:<id>`), so two scopes never share a draft. */
function scopeKey(context: StreamContext, key: string): string {
  return `${context.agentId}:${key}`;
}

function targetOf(params: OutboundPostParams): StreamingDraftTarget {
  return { to: params.to, ...(params.threadId === undefined ? {} : { threadId: params.threadId }) };
}

export class ChannelStreamingProducer {
  private readonly deps: StreamingProducerDeps;
  private readonly drafts = new Map<string, DraftState>();
  private readonly progress = new Map<string, ProgressState>();
  /** Latched after the native transport throws once: the Hub does not have a
   * live platform client to hand upstream's stream primitives until the
   * vertical publishes a Hub-drivable start, so one failure retires native for
   * this account rather than costing an API attempt every turn. */
  private nativeRetired = false;
  /** Reasons this account has already reported. A streaming fault repeats once
   * per token, so the log is latched per reason — loud once, never a flood. */
  private readonly reported = new Set<string>();

  constructor(deps: StreamingProducerDeps) {
    this.deps = deps;
  }

  /** The route's effective streaming mode for one scope. */
  modeFor(context: StreamContext): ChannelStreamingMode {
    const sync = context.route.defaults.sync;
    if (!sync.finalAnswers) return "off";
    return this.deps.driver.resolveMode(sync.streaming);
  }

  /**
   * One assistant message's text so far (the relay's in-flight accumulation).
   * Starts the draft on the first call and paces every later one; a failure
   * only breaks this draft, never the turn.
   */
  async onAssistantText(
    context: StreamContext,
    key: string,
    location: StreamingDraftTarget,
    text: string,
  ): Promise<void> {
    const mode = this.modeFor(context);
    if (mode !== "partial" && mode !== "block") return;
    const id = scopeKey(context, key);
    const draft = this.drafts.get(id);
    if (draft?.closed !== undefined) return;
    if (text.length > this.deps.driver.limits.maxDraftChars) {
      if (draft !== undefined) this.cap(context, draft);
      return;
    }
    if (draft === undefined) {
      await this.startDraft(context, id, location, text, mode);
      return;
    }
    // A call is already on the wire, or the channel's edit pacing has not
    // elapsed: either way this delta's text rides the next push.
    if (draft.inFlight !== undefined) return;
    if (this.deps.clock.now() - draft.lastPushAt < this.deps.driver.limits.minEditIntervalMs)
      return;
    await this.pushDraft(context, draft, text);
  }

  /**
   * Take the scope's finalize transport, clearing the draft: the message is
   * closing, so the next assistant message opens a fresh one. `undefined`
   * means "post this normally" — the relay's own path is unchanged.
   */
  takeFinalizeTransport(
    context: StreamContext,
    key: string,
  ): StreamingFinalizeTransport | undefined {
    const id = scopeKey(context, key);
    const draft = this.drafts.get(id);
    this.drafts.delete(id);
    if (draft === undefined || draft.closed === "failed") return undefined;
    return async (params) => await this.finalize(context, draft, params);
  }

  /**
   * One progress event (a running tool call). Only `streaming.mode: progress`
   * shows it: the turn keeps ONE progress message, posted on the first event
   * and edited in place afterwards, rendered through the vertical's progress
   * blocks when it ships them.
   */
  async onProgress(
    context: StreamContext,
    key: string,
    location: StreamingDraftTarget,
    line: ChannelProgressLine,
  ): Promise<void> {
    if (this.modeFor(context) !== "progress") return;
    const id = scopeKey(context, key);
    let state = this.progress.get(id);
    if (state === undefined) {
      state = { target: location, lines: [], lastPushAt: 0 };
      this.progress.set(id, state);
    }
    state.lines.push(line);
    // A call is already on the wire, or the channel's edit pacing has not
    // elapsed: either way this line rides the next push.
    if (state.inFlight !== undefined) return;
    if (
      state.messageId !== undefined &&
      this.deps.clock.now() - state.lastPushAt < this.deps.driver.limits.minEditIntervalMs
    ) {
      return;
    }
    await this.pushProgress(context, id, state);
  }

  /** Drop a scope's draft and progress state (turn closed, agent detached). */
  discard(context: StreamContext, key: string): void {
    const id = scopeKey(context, key);
    this.drafts.delete(id);
    this.progress.delete(id);
  }

  /** Drop every scope of one agent (plane detach). */
  detach(agentId: string): void {
    // Deleting the current entry during a Map iteration is defined behaviour;
    // the iterator moves on to the next live key.
    for (const map of [this.drafts, this.progress]) {
      for (const id of map.keys()) {
        if (id.startsWith(`${agentId}:`)) map.delete(id);
      }
    }
  }

  // --- Draft lifecycle -------------------------------------------------------

  /** Open a draft: the native transport when the mode and the account admit
   * it, otherwise a posted message this producer edits from here on. */
  private async startDraft(
    context: StreamContext,
    id: string,
    target: StreamingDraftTarget,
    text: string,
    mode: ChannelStreamingMode,
  ): Promise<void> {
    const draft: DraftState = { target, rendered: "", lastPushAt: 0 };
    this.drafts.set(id, draft);
    const { driver } = this.deps;
    const native =
      mode === "partial" &&
      !this.nativeRetired &&
      driver.native !== undefined &&
      target.threadId !== undefined &&
      driver.nativeAllowed(context.route.defaults.sync.streaming);
    await this.attempt(context, draft, async () => {
      if (native && driver.native !== undefined) {
        draft.session = await driver.native.start({ ...target, text });
      } else {
        draft.messageId = await this.postDraft(context, target, text);
      }
      draft.rendered = text;
      draft.lastPushAt = this.deps.clock.now();
    });
  }

  /** Extend an open draft to `text` (always a superset of what it shows). */
  private async pushDraft(context: StreamContext, draft: DraftState, text: string): Promise<void> {
    const { driver } = this.deps;
    await this.attempt(context, draft, async () => {
      if (draft.session !== undefined && driver.native !== undefined) {
        await driver.native.append({ session: draft.session, text: deltaOf(draft.rendered, text) });
      } else if (draft.messageId !== undefined && driver.edit !== undefined) {
        await driver.edit({ ...draft.target, externalMessageId: draft.messageId, text });
      } else {
        // Reached only when the draft has neither an open stream nor a posted
        // message to edit. It is a Hub bug, not a channel refusal, so it
        // throws into `attempt` and gets logged like every other failure.
        throw new Error("the draft has no open stream and no message to edit");
      }
      draft.rendered = text;
      draft.lastPushAt = this.deps.clock.now();
    });
  }

  /**
   * Finish the draft with the turn's full answer. Anything that does not land
   * in the draft falls through to the plain post path here, so the caller
   * always gets exactly one delivered message for its one ledger row.
   */
  private async finalize(
    context: StreamContext,
    draft: DraftState,
    params: OutboundPostParams,
  ): Promise<{ ok: boolean; externalMessageId?: string | undefined; error?: string | undefined }> {
    const { driver } = this.deps;
    // The last paced push can still be on the wire; its edit must not land
    // after the final one and revert the message to a partial answer.
    await draft.inFlight;
    if (params.text.length > driver.limits.maxDraftChars)
      return await this.finalizeOversized(context, draft, params);
    try {
      if (draft.session !== undefined && driver.native !== undefined) {
        const stopped = await driver.native.stop({
          session: draft.session,
          text: deltaOf(draft.rendered, params.text),
        });
        return {
          ok: true,
          ...(stopped.messageId === undefined ? {} : { externalMessageId: stopped.messageId }),
        };
      }
      if (draft.messageId !== undefined && driver.edit !== undefined) {
        await driver.edit({
          ...targetOf(params),
          externalMessageId: draft.messageId,
          text: params.text,
        });
        return { ok: true, externalMessageId: draft.messageId };
      }
    } catch (error) {
      this.retire(context, draft, "channel streaming finalize failed", error);
    }
    return await this.deps.post(params);
  }

  /**
   * Finish an answer the draft cannot hold. The draft message becomes the
   * answer's FIRST message — edited to the largest whole-line prefix that fits
   * — and only the remainder goes through the plain post path, which chunks it
   * as usual. Before this the draft was abandoned wherever the cap caught it
   * and the whole answer was posted beside it (D-W4-03: a `##` stub next to
   * the seven-chunk reply).
   */
  private async finalizeOversized(
    context: StreamContext,
    draft: DraftState,
    params: OutboundPostParams,
  ): Promise<{ ok: boolean; externalMessageId?: string | undefined; error?: string | undefined }> {
    const { driver } = this.deps;
    const head = headOf(params.text, driver.limits.maxDraftChars);
    // A native draft is an OPEN stream: handing the whole answer to the plain
    // post path without stopping it left the stream running beside the reply
    // (the native-transport form of D-W4-03).
    if (draft.session !== undefined && driver.native !== undefined) {
      try {
        await driver.native.stop({ session: draft.session, text: deltaOf(draft.rendered, head) });
      } catch (error) {
        this.retire(context, draft, "channel streaming finalize failed", error);
        return await this.deps.post(params);
      }
      return await this.deps.post({ ...params, text: params.text.slice(head.length) });
    }
    if (draft.messageId === undefined || driver.edit === undefined)
      return await this.deps.post(params);
    try {
      await driver.edit({ ...targetOf(params), externalMessageId: draft.messageId, text: head });
    } catch (error) {
      this.retire(context, draft, "channel streaming finalize failed", error);
      return await this.deps.post(params);
    }
    return await this.deps.post({ ...params, text: params.text.slice(head.length) });
  }

  // --- Transport helpers -----------------------------------------------------

  /** Post the draft's first message through the plain post path. Throws when
   * the channel refuses it, which `attempt` turns into a broken draft. */
  private async postDraft(
    context: StreamContext,
    target: StreamingDraftTarget,
    text: string,
  ): Promise<string> {
    const result = await this.deps.post({
      channel: context.channel,
      accountId: context.accountId,
      ...target,
      text,
    });
    const id = result.externalMessageId;
    if (!result.ok || id === undefined || id === "") {
      throw new Error(result.error ?? "the channel post returned no message id");
    }
    return id;
  }

  /**
   * Run one streaming step as the draft's single in-flight call; a throw breaks
   * this draft instead of the turn. Publishing `inFlight` before awaiting is
   * what keeps the next delta from driving a half-started draft.
   */
  private async attempt(
    context: StreamContext,
    draft: DraftState,
    step: () => Promise<void>,
  ): Promise<void> {
    const run = (async () => {
      try {
        await step();
      } catch (error) {
        this.retire(context, draft, "channel streaming draft failed", error);
      }
    })();
    draft.inFlight = run;
    try {
      await run;
    } finally {
      if (draft.inFlight === run) draft.inFlight = undefined;
    }
  }

  /** The answer outgrew the channel's text cap — expected, not a fault. */
  private cap(context: StreamContext, draft: DraftState): void {
    draft.closed = "capped";
    this.report(context, "info", "channel streaming draft reached the channel text cap");
  }

  /** A refused streaming call ends this draft; a refused NATIVE call also
   * retires the native transport for the whole account. */
  private retire(context: StreamContext, draft: DraftState, message: string, error: unknown): void {
    if (draft.session !== undefined) this.nativeRetired = true;
    draft.closed = "failed";
    this.report(context, "warn", message, error);
  }

  /**
   * Say it once per account per reason. A streaming fault repeats on every
   * token, so an unlatched log floods and a swallowed one leaves the next live
   * run with nothing to read — D-W4-03 lost a whole wave to the second.
   */
  private report(
    context: StreamContext,
    level: "warn" | "info",
    message: string,
    error?: unknown,
  ): void {
    if (this.reported.has(message)) return;
    this.reported.add(message);
    const write = level === "warn" ? this.deps.logger.warn : this.deps.logger.info;
    write?.call(this.deps.logger, message, {
      channel: context.channel,
      accountId: context.accountId,
      agentId: context.agentId,
      ...(error === undefined
        ? {}
        : { error: error instanceof Error ? error.message : String(error) }),
    });
  }

  /** Post or edit the turn's single progress message, as its one in-flight
   * call — the guard `onProgress` reads before starting another. */
  private async pushProgress(
    context: StreamContext,
    id: string,
    state: ProgressState,
  ): Promise<void> {
    const run = this.runProgressPush(context, id, state);
    state.inFlight = run;
    try {
      await run;
    } finally {
      if (state.inFlight === run) state.inFlight = undefined;
    }
  }

  private async runProgressPush(
    context: StreamContext,
    id: string,
    state: ProgressState,
  ): Promise<void> {
    const { driver } = this.deps;
    const latest = state.lines.at(-1);
    const text = latest?.text ?? "Working…";
    const blocks = driver.progressBlocks?.({ title: text, lines: state.lines, done: false });
    try {
      if (state.messageId === undefined) {
        const result = await this.deps.post({
          channel: context.channel,
          accountId: context.accountId,
          ...state.target,
          text,
          ...(blocks === undefined ? {} : { blocks }),
        });
        if (result.ok && result.externalMessageId !== undefined) {
          state.messageId = result.externalMessageId;
        }
      } else if (driver.edit !== undefined) {
        await driver.edit({ ...state.target, externalMessageId: state.messageId, text });
      }
      state.lastPushAt = this.deps.clock.now();
    } catch (error) {
      this.deps.logger.warn("channel streaming progress failed", {
        channel: context.channel,
        accountId: context.accountId,
        error: error instanceof Error ? error.message : String(error),
      });
      // One failure retires the turn's progress message: the surface is a
      // convenience, and a channel that refuses it will refuse every retry.
      this.progress.delete(id);
    }
  }
}

/** What a draft still has to push: the answer only ever extends, so a divergent
 * value (a provider replay) resends the whole text rather than a wrong tail. */
function deltaOf(rendered: string, text: string): string {
  return text.startsWith(rendered) ? text.slice(rendered.length) : text;
}

/** The answer's first message: the largest prefix that fits the channel's text
 * cap, ending on a line boundary when one falls in its second half — so a long
 * answer breaks at a paragraph rather than mid-word. */
function headOf(text: string, maxChars: number): string {
  const head = text.slice(0, maxChars);
  const boundary = head.lastIndexOf("\n");
  return boundary > maxChars / 2 ? head.slice(0, boundary) : head;
}
