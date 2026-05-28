import type { WebSocket } from "ws";

export type WebChunk = { id: string; text: string };

export type HistoryMessage = { role: "user" | "assistant"; text: string };

export function sendWebHistory(ws: WebSocket, todoId: string, messages: HistoryMessage[]) {
  ws.send(JSON.stringify({ type: "history", todoId, messages }));
}

export function sendAnnotation(ws: WebSocket, todoId: string | undefined, key: string, value: string) {
  ws.send(JSON.stringify({ type: "annotation", todoId, key, value }));
}

let chunkCounter = 0;
function nextChunkId() {
  return `wc${++chunkCounter}`;
}

export async function postWebText(
  ws: WebSocket,
  text: string,
): Promise<WebChunk[]> {
  const chunk: WebChunk = { id: nextChunkId(), text };
  ws.send(JSON.stringify({ type: "chunk", id: chunk.id, text }));
  return [chunk];
}

export async function reconcileWebText(
  ws: WebSocket,
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

export function sendWebDone(ws: WebSocket) {
  ws.send(JSON.stringify({ type: "done" }));
}

export function sendWebError(ws: WebSocket, message: string) {
  ws.send(JSON.stringify({ type: "error", message }));
}
