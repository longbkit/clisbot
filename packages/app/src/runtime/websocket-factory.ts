import { nativeWebSocketFactory } from "@clisbot/client/internal/daemon-client-websocket-transport";
import type { WebSocketFactory } from "@clisbot/client/internal/daemon-client-transport-types";

export function createAppWebSocketFactory(): WebSocketFactory {
  return nativeWebSocketFactory;
}
