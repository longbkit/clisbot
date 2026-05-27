import type { ServerWebSocket } from "bun";
import type { WebSocketData } from "./service.ts";

export type WebChunk = { id: string; text: string };

let chunkCounter = 0;
function nextChunkId() {
  return `wc${++chunkCounter}`;
}

export async function postWebText(
  ws: ServerWebSocket<WebSocketData>,
  text: string,
): Promise<WebChunk[]> {
  const chunk: WebChunk = { id: nextChunkId(), text };
  ws.send(JSON.stringify({ type: "chunk", id: chunk.id, text }));
  return [chunk];
}

export async function reconcileWebText(
  ws: ServerWebSocket<WebSocketData>,
  chunks: WebChunk[],
  text: string,
): Promise<WebChunk[]> {
  if (chunks.length === 0) {
    return postWebText(ws, text);
  }
  const firstId = chunks[0].id;
  ws.send(JSON.stringify({ type: "update", id: firstId, text }));
  return [{ id: firstId, text }];
}

export function sendWebDone(ws: ServerWebSocket<WebSocketData>) {
  ws.send(JSON.stringify({ type: "done" }));
}

export function sendWebError(ws: ServerWebSocket<WebSocketData>, message: string) {
  ws.send(JSON.stringify({ type: "error", message }));
}
