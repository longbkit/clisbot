import { beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage } from "./contracts";
import {
  mergeTranscriptMessages,
  selectTranscript,
  transcriptKey,
  useTranscriptStore,
} from "./transcript-store";

function line(seq: number, text = `m${seq}`): ChatMessage {
  return {
    id: `id-${seq}`,
    seq,
    at: new Date(seq * 1000).toISOString(),
    sender: { kind: "user" },
    text,
  };
}

const KEY = transcriptKey("host-a", "chat-1");

beforeEach(() => {
  useTranscriptStore.setState({ transcripts: {} });
});

describe("mergeTranscriptMessages", () => {
  it("keeps the existing array identity when nothing is new", () => {
    const existing = [line(1), line(2)];
    expect(mergeTranscriptMessages(existing, [line(2)])).toBe(existing);
  });

  it("orders by seq regardless of arrival order", () => {
    expect(mergeTranscriptMessages([line(3)], [line(1), line(2)]).map((m) => m.seq)).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("transcript store", () => {
  it("prepends an older page without duplicating the overlap", () => {
    const store = useTranscriptStore.getState();
    store.replacePage(KEY, { messages: [line(3), line(4)], hasOlder: true });
    store.prependOlder(KEY, [line(1), line(2), line(3)], false);
    const transcript = selectTranscript(useTranscriptStore.getState(), KEY);
    expect(transcript.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    expect(transcript.hasOlder).toBe(false);
  });

  it("appends by id and ignores a repeated push", () => {
    const store = useTranscriptStore.getState();
    store.replacePage(KEY, { messages: [line(1)], hasOlder: false });
    store.append(KEY, line(2));
    const before = selectTranscript(useTranscriptStore.getState(), KEY);
    store.append(KEY, line(2, "edited copy"));
    const after = selectTranscript(useTranscriptStore.getState(), KEY);
    expect(after).toBe(before);
    expect(after.messages.map((m) => m.text)).toEqual(["m1", "m2"]);
  });

  it("keeps chats apart", () => {
    const other = transcriptKey("host-a", "chat-2");
    const store = useTranscriptStore.getState();
    store.append(KEY, line(1));
    store.append(other, line(9));
    expect(selectTranscript(useTranscriptStore.getState(), KEY).messages).toHaveLength(1);
    expect(selectTranscript(useTranscriptStore.getState(), other).messages[0]?.seq).toBe(9);
    store.clear(KEY);
    expect(selectTranscript(useTranscriptStore.getState(), KEY).messages).toHaveLength(0);
    expect(selectTranscript(useTranscriptStore.getState(), other).messages).toHaveLength(1);
  });
});

it("preserves a live push arriving before a stale page response", () => {
  const store = useTranscriptStore.getState();
  store.append(KEY, line(3));
  store.replacePage(KEY, { messages: [line(1), line(2)], hasOlder: false });
  expect(selectTranscript(useTranscriptStore.getState(), KEY).messages.map((m) => m.seq)).toEqual([
    1, 2, 3,
  ]);
});
