import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import type { QuickStartAuthority } from "./store.js";
import { QuickStartError, QuickStartStore } from "./store.js";
export class QuickStartSession {
  private unsubscribe: () => void;
  constructor(
    private readonly store: QuickStartStore,
    private readonly authority: () => QuickStartAuthority,
    private readonly emit: (message: SessionOutboundMessage) => void,
  ) {
    this.unsubscribe = store.subscribe(() =>
      emit({ type: "quick_start.changed", payload: { changed: true } }),
    );
  }
  dispose() {
    this.unsubscribe();
  }
  dispatch(message: SessionInboundMessage): Promise<void> | undefined {
    switch (message.type) {
      case "quick_start.list.request":
        return this.respond(message, () => this.store.list(this.authority()));
      case "quick_start.save.request":
        return this.respond(message, () =>
          this.store.save(this.authority(), message.id, message.expectedRevision, message.input),
        );
      case "quick_start.delete.request":
        return this.respond(message, () =>
          this.store.remove(this.authority(), message.id, message.expectedRevision),
        );
      case "quick_start.set_pins.request":
        return this.respond(message, () =>
          this.store.setPins(this.authority(), message.pinnedIds, message.expectedRevision),
        );
    }
  }
  private async respond(
    message: Extract<SessionInboundMessage, { type: `quick_start.${string}` }>,
    action: () => ReturnType<QuickStartStore["list"]>,
  ) {
    const type = message.type.replace(/\.request$/, ".response") as "quick_start.list.response";
    try {
      this.emit({
        type,
        payload: { requestId: message.requestId, ...(await action()), error: null },
      });
    } catch (error) {
      this.emit({
        type,
        payload: {
          requestId: message.requestId,
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof QuickStartError ? { errorCode: error.code } : {}),
        },
      });
    }
  }
}
