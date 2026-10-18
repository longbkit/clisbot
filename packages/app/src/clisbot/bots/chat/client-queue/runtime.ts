import type { ChatPayload } from "@clisbot/protocol/chats/types";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { QueuedComposerMessage } from "@/composer/actions";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore, selectAgentTurnPresentation } from "@/stores/session-store";
import { resolveChatSendAction } from "../chat-send-action";
import { sendChatInput } from "../send-chat-input";
import { isGroupChat } from "../chat-kind";
import { clientChatBusy } from "./readiness";
import { ClientChatQueue, ChatQueueNotReady } from "./owner";

/** A pending Chat observes existing Host/session projections; it does not own another scheduler. */
export class ClientChatQueueRuntime {
  readonly queue: ClientChatQueue;
  private cleanups: (() => void)[] = [];
  private feed: { release(): Promise<unknown> } | null = null;
  private client: DaemonClient | null = null;
  private epoch: number | undefined;
  private chat: ChatPayload | null = null;
  private chatVersion = 0;
  private enabled = false;
  private scheduled = false;
  constructor(
    readonly serverId: string,
    readonly chatId: string,
    admit?: () => void,
  ) {
    this.queue = new ClientChatQueue({ prepare: this.prepare, changed: this.changed, admit });
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.changed();
  }
  private changed = () => {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.refresh();
    });
  };
  private refresh() {
    if (!this.enabled || !this.queue.hasWork) {
      this.detach();
      return;
    }
    if (!this.cleanups.length)
      this.cleanups = [
        getHostRuntimeStore().subscribe(this.serverId, this.changed),
        useSessionStore.subscribe(this.changed),
      ];
    const client = this.onlineClient();
    const epoch = getHostRuntimeStore().getSnapshot(this.serverId)?.connectionEpoch;
    if (client !== this.client || epoch !== this.epoch) this.bind(client);
    if (!client) return;
    if (this.chat) this.queue.observe(this.busy(this.chat));
    this.queue.pump();
  }
  private onlineClient() {
    const host = getHostRuntimeStore().getSnapshot(this.serverId);
    return this.enabled &&
      host?.connectionStatus === "online" &&
      !host.authFailureReason &&
      !host.client?.authFailureReason
      ? host.client
      : null;
  }
  private busy(chat: ChatPayload) {
    const host = getHostRuntimeStore().getSnapshot(this.serverId);
    const session = useSessionStore.getState().sessions[this.serverId];
    if (!this.onlineClient() || host?.agentDirectoryStatus !== "ready") return null;
    return clientChatBusy(chat, (id) => ({
      known: Boolean(session?.agents.has(id)),
      active: selectAgentTurnPresentation(session, id).isActive,
      permission: [...(session?.pendingPermissions.values() ?? [])].some((p) => p.agentId === id),
    }));
  }
  private bind(client: DaemonClient | null) {
    void this.feed?.release().catch(() => undefined);
    this.client = client;
    this.epoch = getHostRuntimeStore().getSnapshot(this.serverId)?.connectionEpoch;
    this.chat = null;
    this.chatVersion++;
    this.feed = null;
    if (!client) return;
    const waitingId = this.queue.waitingMessageId;
    if (waitingId) void this.reconcileReply(client, waitingId);
    const feed = client.observeEvents(["chat.updated", "chat.transcript.appended"]);
    this.feed = feed;
    feed.subscribe({
      snapshot: () => {},
      update: (event) => {
        if (this.client !== client || this.feed !== feed) return;
        if (event.type === "chat.updated" && event.payload.chat.id === this.chatId) {
          this.chatVersion++;
          this.chat = event.payload.chat;
        }
        if (
          event.type === "chat.transcript.appended" &&
          event.payload.chatId === this.chatId &&
          event.payload.line.sender.kind !== "user"
        )
          this.queue.observe(null, event.payload.line.inReplyTo);
        this.changed();
      },
    });
  }
  /** Reconnect can miss a whole turn; a matching transcript reply proves its receipt completed. */
  private async reconcileReply(client: DaemonClient, messageId: string) {
    try {
      const response = await client.fetchChatTranscript({
        chatId: this.chatId,
        direction: "tail",
        limit: 200,
      });
      if (this.client !== client || this.queue.waitingMessageId !== messageId || response.error)
        return;
      if (
        response.lines.some((line) => line.sender.kind !== "user" && line.inReplyTo === messageId)
      ) {
        this.queue.observe(null, messageId);
        this.changed();
      }
    } catch {
      /* A failed read is no completion proof; retain the original owner and input. */
    }
  }
  private prepare = async (
    item: QueuedComposerMessage,
    behavior?: "steer" | "interrupt" | "send",
  ) => {
    const client = this.onlineClient();
    if (!client) return null;
    if (!behavior && this.chat && this.busy(this.chat) !== false) return null;
    const host = getHostRuntimeStore().getSnapshot(this.serverId);
    const version = this.chatVersion;
    const response = await client.listChats();
    if (
      client !== this.onlineClient() ||
      host?.connectionEpoch !== getHostRuntimeStore().getSnapshot(this.serverId)?.connectionEpoch
    )
      return null;
    if (response.error) throw new Error(response.error);
    const fetched = response.chats.find((c) => c.id === this.chatId && !c.archivedAt);
    const chat = version === this.chatVersion ? fetched : this.chat;
    if (!fetched || !chat || chat.archivedAt)
      throw new Error("Chat is unavailable; queued input retained for review");
    this.chat = chat;
    this.queue.setManualDelivery(isGroupChat(chat) && chat.discussionActive === undefined);
    this.validateAction(chat, behavior);
    if (!behavior && this.busy(chat) !== false) return null;
    return this.handoff(item, client, chat, host?.connectionEpoch, behavior);
  };
  private validateAction(chat: ChatPayload, behavior?: "steer" | "interrupt" | "send") {
    if (behavior && behavior !== "send") {
      if (
        behavior === "interrupt" &&
        useSessionStore.getState().sessions[this.serverId]?.serverInfo?.features?.hostInputQueue !==
          true
      )
        throw new Error("This Host cannot explicitly interrupt a queued Chat item");
      resolveChatSendAction({ serverId: this.serverId, chat, behavior });
    }
  }
  private handoff(
    item: QueuedComposerMessage,
    client: DaemonClient,
    chat: ChatPayload,
    epoch: number | undefined,
    behavior?: "steer" | "interrupt" | "send",
  ) {
    return () =>
      sendChatInput({
        client,
        freshFiles: true,
        serverId: this.serverId,
        chat,
        messageId: item.id,
        payload: {
          text: item.text,
          attachments: item.attachments,
          cwd: "",
          activeTurnBehavior: behavior === "send" ? undefined : behavior,
        },
        beforeSend: () => {
          if (
            client !== this.onlineClient() ||
            epoch !== getHostRuntimeStore().getSnapshot(this.serverId)?.connectionEpoch ||
            (!behavior && this.busy(this.chat ?? chat) !== false)
          )
            throw new ChatQueueNotReady("Chat readiness changed before handoff");
        },
      });
  }
  private detach() {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.bind(null);
  }
}
