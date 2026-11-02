import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { AttachmentMetadata } from "@/attachments/types";
import { useSessionStore } from "@/stores/session-store";
import type { StreamItem, UserMessageItem } from "@/types/stream";
import {
  discardAgentSend,
  restoreAgentOutbox,
  retryAgentSend,
  startAgentSend,
} from "./agent-delivery";
import { useOutboxStore } from "./store";

vi.mock("@/attachments/service", () => ({
  encodeImageMessagesForSend: async (images: AttachmentMetadata[]) =>
    images.length === 0
      ? []
      : images.map((image) => [{ data: image.id, mimeType: image.mimeType }]),
}));

const SERVER = "outbox-host";
const AGENT = "agent-1";

interface SendCall {
  agentId: string;
  text: string;
  options: { messageId: string; activeTurnBehavior?: string; images?: unknown[] };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeClient(answer: (call: SendCall) => Promise<void> = async () => {}) {
  const calls: SendCall[] = [];
  const client = {
    sendAgentMessage: async (agentId: string, text: string, options: SendCall["options"]) => {
      const call = { agentId, text, options };
      calls.push(call);
      await answer(call);
      return {};
    },
    uploadFile: async () => ({ requestId: "r", file: null, error: null }),
  };
  return { client: client as unknown as DaemonClient, calls };
}

function startSession(client: DaemonClient | null): void {
  const store = useSessionStore.getState();
  store.initializeSession(SERVER, client as DaemonClient);
  store.updateSessionServerInfo(SERVER, {
    serverId: SERVER,
    hostname: null,
    version: "2.2.1",
    features: { canonicalSubmittedPrompts: true },
  });
}

/** A Host with the input queue, running the turn a Steer names. */
function openTurn(turnId: string): void {
  useSessionStore.getState().updateSessionServerInfo(SERVER, {
    serverId: SERVER,
    hostname: null,
    version: "2.2.1",
    features: { canonicalSubmittedPrompts: true, hostInputQueue: true },
  });
  useSessionStore.setState((state) => {
    const session = state.sessions[SERVER]!;
    const turn = { phase: "open", turnId, startedAt: null, cancellationRequestId: null };
    const agentDetails = new Map(session.agentDetails).set(AGENT, { turn } as never);
    return { sessions: { ...state.sessions, [SERVER]: { ...session, agentDetails } } };
  });
}

function rows(): UserMessageItem[] {
  const session = useSessionStore.getState().sessions[SERVER];
  const items: StreamItem[] = [
    ...(session?.agentStreamTail.get(AGENT) ?? []),
    ...(session?.agentStreamHead.get(AGENT) ?? []),
  ];
  return items.filter((item): item is UserMessageItem => item.kind === "user_message");
}

function submission(clientMessageId: string) {
  return useSessionStore
    .getState()
    .sessions[SERVER]?.messageSubmissions.get(AGENT)
    ?.find((record) => record.clientMessageId === clientMessageId);
}

beforeEach(() => {
  useOutboxStore.setState({ entries: {}, accepted: {} });
});

afterEach(() => {
  useSessionStore.getState().clearSession(SERVER);
});

describe("instant agent send", () => {
  it("shows the row in the press frame, before the Host answers", async () => {
    const answer = deferred();
    const { client } = fakeClient(() => answer.promise);
    startSession(client);

    const { clientMessageId, delivery } = startAgentSend({
      serverId: SERVER,
      agentId: AGENT,
      text: "hello",
      attachments: [],
    });

    // Synchronous: no await between the press and the row.
    expect(rows().map((row) => row.clientMessageId)).toEqual([clientMessageId]);
    expect(useOutboxStore.getState().entries[clientMessageId]?.status).toBe("sending");
    answer.resolve();
    await expect(delivery).resolves.toEqual({ kind: "sent" });
    expect(useOutboxStore.getState().entries[clientMessageId]).toBeUndefined();
    expect(rows()).toHaveLength(1);
  });

  it("sends a second message only after the Host answered the first, rows shown at once", async () => {
    const first = deferred();
    const { client, calls } = fakeClient((call) =>
      call.text === "one" ? first.promise : Promise.resolve(),
    );
    startSession(client);
    const one = startAgentSend({ serverId: SERVER, agentId: AGENT, text: "one", attachments: [] });
    const two = startAgentSend({ serverId: SERVER, agentId: AGENT, text: "two", attachments: [] });
    expect(rows().map((row) => row.text)).toEqual(["one", "two"]);
    const sentTexts = () => calls.map((call) => call.text);
    await vi.waitFor(() => expect(sentTexts()).toEqual(["one"]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sentTexts()).toEqual(["one"]);
    first.resolve();
    await Promise.all([one.delivery, two.delivery]);
    expect(calls.map((call) => call.text)).toEqual(["one", "two"]);
  });

  it("keeps a refused message in place as failed, then retries it under the same id", async () => {
    let refuse = true;
    const { client, calls } = fakeClient(async () => {
      if (refuse) throw new Error("Agent is busy");
    });
    startSession(client);

    const { clientMessageId, delivery } = startAgentSend({
      serverId: SERVER,
      agentId: AGENT,
      text: "retry me",
      attachments: [],
    });
    await expect(delivery).resolves.toMatchObject({
      kind: "failed",
      failure: { reason: "refused", message: "Agent is busy", autoRetry: false },
    });
    expect(rows().map((row) => row.clientMessageId)).toEqual([clientMessageId]);
    expect(useOutboxStore.getState().entries[clientMessageId]?.status).toBe("failed");
    expect(submission(clientMessageId)?.failure?.message).toBe("Agent is busy");

    refuse = false;
    await expect(retryAgentSend(clientMessageId)).resolves.toEqual({ kind: "sent" });
    expect(calls.map((call) => call.options.messageId)).toEqual([clientMessageId, clientMessageId]);
    expect(useOutboxStore.getState().entries[clientMessageId]).toBeUndefined();
    expect(rows()).toHaveLength(1);
  });

  it("counts a retry the Host already holds as sent, never resending under a new id", async () => {
    let attempt = 0;
    const { client, calls } = fakeClient(async () => {
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error("lost"), { name: "DaemonConnectionError" });
      throw new Error("agent_request_key_conflict");
    });
    startSession(client);

    const { clientMessageId, delivery } = startAgentSend({
      serverId: SERVER,
      agentId: AGENT,
      text: "maybe delivered",
      attachments: [],
    });
    await expect(delivery).resolves.toMatchObject({
      kind: "failed",
      failure: { reason: "host_unreachable", autoRetry: true },
    });
    await expect(retryAgentSend(clientMessageId)).resolves.toEqual({ kind: "sent" });
    expect(new Set(calls.map((call) => call.options.messageId))).toEqual(
      new Set([clientMessageId]),
    );
    expect(useOutboxStore.getState().entries[clientMessageId]).toBeUndefined();
  });

  it("waits for the Host when there is no connection, and a failed row does not look busy", async () => {
    startSession(null);
    const { clientMessageId, delivery } = startAgentSend({
      serverId: SERVER,
      agentId: AGENT,
      text: "offline",
      attachments: [],
    });
    await expect(delivery).resolves.toMatchObject({
      kind: "failed",
      failure: { reason: "host_unreachable", autoRetry: true },
    });
    const session = useSessionStore.getState().sessions[SERVER];
    expect(rows().map((row) => row.clientMessageId)).toEqual([clientMessageId]);
    expect(session?.messageSubmissions.get(AGENT)?.every((record) => record.failure)).toBe(true);
  });

  it("deletes a failed message with its row", async () => {
    const { client } = fakeClient(async () => {
      throw new Error("No");
    });
    startSession(client);
    const { clientMessageId, delivery } = startAgentSend({
      serverId: SERVER,
      agentId: AGENT,
      text: "delete me",
      attachments: [],
    });
    await delivery;
    discardAgentSend(clientMessageId);
    expect(rows()).toEqual([]);
    expect(useOutboxStore.getState().entries[clientMessageId]).toBeUndefined();
  });

  it("sends a Steer whose turn ended first as a plain message, under the same id", async () => {
    const { client, calls } = fakeClient(async (call) => {
      if ((call.options as { expectedTurnId?: string }).expectedTurnId) {
        throw new Error("Active turn changed before steering could be delivered");
      }
    });
    startSession(client);
    openTurn("turn-a");

    const { clientMessageId, delivery } = startAgentSend({
      serverId: SERVER,
      agentId: AGENT,
      text: "late steer",
      attachments: [],
      activeTurnBehavior: "steer",
    });

    await expect(delivery).resolves.toEqual({ kind: "sent" });
    expect(
      calls.map((call) => (call.options as { expectedTurnId?: string }).expectedTurnId),
    ).toEqual(["turn-a", undefined]);
    expect(calls.map((call) => call.options.messageId)).toEqual([clientMessageId, clientMessageId]);
    expect(useOutboxStore.getState().entries[clientMessageId]).toBeUndefined();
  });

  it("keeps a late Steer unsent when an older Host still holds the refused attempt's id", async () => {
    const { client } = fakeClient(async (call) => {
      if ((call.options as { expectedTurnId?: string }).expectedTurnId) {
        throw new Error("Active turn changed before steering could be delivered");
      }
      throw new Error("agent_request_key_conflict");
    });
    startSession(client);
    openTurn("turn-a");

    const { clientMessageId, delivery } = startAgentSend({
      serverId: SERVER,
      agentId: AGENT,
      text: "late steer",
      attachments: [],
      activeTurnBehavior: "steer",
    });

    const outcome = await delivery;
    expect(outcome.kind).toBe("failed");
    expect(useOutboxStore.getState().entries[clientMessageId]?.status).toBe("failed");
  });

  it("gives the earlier parts of a split message derived ids, so a retry dedupes them too", async () => {
    const { client, calls } = fakeClient();
    startSession(client);
    const image = (id: string): AttachmentMetadata => ({
      id,
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: id,
      fileName: `${id}.png`,
      byteSize: 1,
      createdAt: 1,
    });
    const { clientMessageId, delivery } = startAgentSend({
      serverId: SERVER,
      agentId: AGENT,
      text: "two images",
      attachments: [
        { kind: "image", metadata: image("a") },
        { kind: "image", metadata: image("b") },
      ],
    });
    await delivery;
    expect(calls.map((call) => call.options.messageId)).toEqual([
      `${clientMessageId}-part-1`,
      clientMessageId,
    ]);
    expect(calls.at(-1)?.text).toBe("two images");
  });
});

describe("restart", () => {
  it("persists a pending send at the press", async () => {
    const answer = deferred();
    const { client } = fakeClient(() => answer.promise);
    startSession(client);
    const { clientMessageId } = startAgentSend({
      serverId: SERVER,
      agentId: AGENT,
      text: "survive me",
      attachments: [],
    });
    const storage = (await import("@react-native-async-storage/async-storage")).default;
    const persisted = JSON.parse((await storage.getItem("clisbot-outbox:v1")) ?? "{}") as {
      state?: { entries?: Record<string, { status: string }> };
    };
    expect(persisted.state?.entries?.[clientMessageId]?.status).toBe("sending");
    answer.resolve();
  });

  it("puts a send cut off by a restart back in place once, and reports it due", () => {
    startSession(fakeClient().client);
    const clientMessageId = "msg_restored";
    // What the persisted outbox holds after the app was killed mid-send.
    useOutboxStore.setState({
      entries: {
        [clientMessageId]: {
          clientMessageId,
          target: { kind: "agent", serverId: SERVER, agentId: AGENT },
          text: "survive me",
          attachments: [],
          createdAt: 1,
          status: "sending",
        },
      },
      accepted: {},
    });

    expect(restoreAgentOutbox(SERVER)).toEqual([clientMessageId]);
    expect(rows().map((row) => row.clientMessageId)).toEqual([clientMessageId]);
    restoreAgentOutbox(SERVER);
    expect(rows()).toHaveLength(1);
  });

  it("does not report a failed refusal as due", async () => {
    const { client } = fakeClient(async () => {
      throw new Error("Refused");
    });
    startSession(client);
    const { delivery } = startAgentSend({
      serverId: SERVER,
      agentId: AGENT,
      text: "refused",
      attachments: [],
    });
    await delivery;
    expect(restoreAgentOutbox(SERVER)).toEqual([]);
  });
});
