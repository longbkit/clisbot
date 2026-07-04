// In-process fan-out of run activity per sessionKey: every observer-facing
// run update and every structured RunEvent is published here so pane-less
// surfaces (web SSE, future operator event-log views) can replay recent
// history and follow live activity.
//
// Deliberately process-local and bounded: entries are a rendering feed, not
// persistence. A runtime restart drops replay history; conversations resume
// from stored session state as usual.

import type { RunEvent } from "../../runners/contract/run-event.ts";
import type { PromptExecutionStatus } from "./run-observation.ts";

const FEED_RING_LIMIT = 200;
const FEED_SNAPSHOT_MAX_CHARS = 8_000;

export type SessionFeedUpdate = {
  kind: "run-update";
  status: PromptExecutionStatus;
  snapshot: string;
  note?: string;
};

export type SessionFeedRunEvent = {
  kind: "run-event";
  event: RunEvent;
};

export type SessionFeedEntry = {
  seq: number;
  at: number;
  sessionKey: string;
  agentId: string;
  payload: SessionFeedUpdate | SessionFeedRunEvent;
};

type FeedListener = (entry: SessionFeedEntry) => void;

type SessionFeedChannel = {
  entries: SessionFeedEntry[];
  listeners: Set<FeedListener>;
};

export class SessionEventFeed {
  private nextSeq = 1;
  private readonly channels = new Map<string, SessionFeedChannel>();

  publishUpdate(
    target: { sessionKey: string; agentId: string },
    update: { status: PromptExecutionStatus; snapshot: string; note?: string },
  ) {
    this.publish(target, {
      kind: "run-update",
      status: update.status,
      snapshot: update.snapshot.slice(0, FEED_SNAPSHOT_MAX_CHARS),
      note: update.note,
    });
  }

  publishRunEvent(target: { sessionKey: string; agentId: string }, event: RunEvent) {
    this.publish(target, {
      kind: "run-event",
      event,
    });
  }

  /** Entries newer than sinceSeq (0 = full retained history), oldest first. */
  read(sessionKey: string, sinceSeq = 0): SessionFeedEntry[] {
    const channel = this.channels.get(sessionKey);
    if (!channel) {
      return [];
    }
    return channel.entries.filter((entry) => entry.seq > sinceSeq);
  }

  subscribe(sessionKey: string, listener: FeedListener) {
    const channel = this.ensureChannel(sessionKey);
    channel.listeners.add(listener);
    return () => {
      channel.listeners.delete(listener);
      if (channel.listeners.size === 0 && channel.entries.length === 0) {
        this.channels.delete(sessionKey);
      }
    };
  }

  private publish(
    target: { sessionKey: string; agentId: string },
    payload: SessionFeedUpdate | SessionFeedRunEvent,
  ) {
    const channel = this.ensureChannel(target.sessionKey);
    const entry: SessionFeedEntry = {
      seq: this.nextSeq++,
      at: Date.now(),
      sessionKey: target.sessionKey,
      agentId: target.agentId,
      payload,
    };
    channel.entries.push(entry);
    if (channel.entries.length > FEED_RING_LIMIT) {
      channel.entries.splice(0, channel.entries.length - FEED_RING_LIMIT);
    }
    for (const listener of channel.listeners) {
      try {
        listener(entry);
      } catch {
        // A broken subscriber must never affect run supervision or other
        // subscribers; SSE writers handle their own teardown.
      }
    }
  }

  private ensureChannel(sessionKey: string) {
    let channel = this.channels.get(sessionKey);
    if (!channel) {
      channel = { entries: [], listeners: new Set() };
      this.channels.set(sessionKey, channel);
    }
    return channel;
  }
}
