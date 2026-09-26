import { beforeEach, expect, it } from "vitest";
import { scopedTranscriptKey } from "./session-scope";
import { selectTranscript, useTranscriptStore } from "./transcript-store";

beforeEach(() => useTranscriptStore.setState({ transcripts: {} }));
it("does not expose a previous admission's transcript while a new identity loads", () => {
  const oldAdmission = { connectionStatus: "online", clientGeneration: 1, connectionEpoch: 1 };
  const newAdmission = { connectionStatus: "online", clientGeneration: 2, connectionEpoch: 2 };
  const oldKey = scopedTranscriptKey("host", "chat", oldAdmission);
  const newKey = scopedTranscriptKey("host", "chat", newAdmission);
  useTranscriptStore.getState().append(oldKey, {
    id: "private",
    seq: 1,
    at: "2026-09-26",
    text: "Private answer",
    sender: { kind: "user" },
  });
  expect(selectTranscript(useTranscriptStore.getState(), newKey).messages).toEqual([]);
  // An old request completing late writes into the old scope only.
  useTranscriptStore.getState().replacePage(oldKey, {
    messages: [
      {
        id: "private",
        seq: 1,
        at: "2026-09-26",
        text: "Private answer",
        sender: { kind: "user" },
      },
    ],
    hasOlder: false,
  });
  expect(selectTranscript(useTranscriptStore.getState(), newKey).messages).toEqual([]);
});
it("revalidates access on a reconnect even if the client object was reused", () => {
  expect(
    scopedTranscriptKey("host", "chat", {
      connectionStatus: "online",
      clientGeneration: 1,
      connectionEpoch: 1,
    }),
  ).not.toBe(
    scopedTranscriptKey("host", "chat", {
      connectionStatus: "online",
      clientGeneration: 1,
      connectionEpoch: 2,
    }),
  );
});
