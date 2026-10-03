import { WebSocket, type RawData } from "ws";
import type { Transport } from "./encrypted-channel.js";

/** Preserve frame kind: text handshake frames and binary ciphertext are distinct. */
export function nodeWebSocketTransport(socket: WebSocket): Transport {
  const transport: Transport = {
    send: (data) =>
      new Promise<void>((resolve, reject) =>
        socket.send(data, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        }),
      ),
    close: (code, reason) => socket.close(code, reason),
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  socket.on("message", (data: RawData, binary) => {
    const bytes = frameBuffer(data);
    transport.onmessage?.({
      data: binary ? Uint8Array.from(bytes).buffer : bytes.toString("utf8"),
      isBinary: binary,
    });
  });
  socket.on("close", (code, reason) => transport.onclose?.(code, reason.toString()));
  socket.on("error", (error) => transport.onerror?.(error));
  return transport;
}

function frameBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? Buffer.from(data) : data;
}
