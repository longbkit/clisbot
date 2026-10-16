import { describe, expect, it, vi } from "vitest";
import { EncryptedChannel, type Transport } from "./encrypted-channel.js";
import { encryptWithNonce, decrypt } from "./crypto.js";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./base64.js";
import { RECEIVE_FRAME_BYTES, RECEIVE_QUEUE_FRAMES, type ReceiveCodec } from "./receive-codec.js";

const key = new Uint8Array(32).fill(7);
function frame(text: string, counter: number) {
  const nonce = new Uint8Array(24).fill(9);
  new DataView(nonce.buffer).setUint32(20, counter);
  return encryptWithNonce(key, text, nonce);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function open(data: string | ArrayBuffer, binary: boolean) {
  const bundle = typeof data === "string" ? base64ToArrayBuffer(data) : data;
  const plaintext = decrypt(key, bundle);
  return {
    nonce: bundle.slice(0, 24),
    plaintext: binary ? plaintext : new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
  };
}
function harness(codec: ReceiveCodec, negotiated = true) {
  const transport: Transport = {
    send: vi.fn(),
    close: vi.fn(),
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  const deliver = vi.fn();
  const channel = new EncryptedChannel(
    transport,
    key,
    { onmessage: deliver },
    { binaryCiphertext: negotiated, receiveCodec: codec },
  );
  channel.setState("open");
  const send = (data: string | ArrayBuffer, isBinary = typeof data !== "string") =>
    transport.onmessage?.({ data, isBinary });
  return { transport, channel, deliver, send };
}

describe("optional ordered receive codec", () => {
  it("serializes modern text/binary and stray ready without changing nonce order", async () => {
    const gate = deferred<void>();
    const opener = vi.fn<ReceiveCodec["open"]>(async (_key, data, binary) => {
      if (opener.mock.calls.length === 1) await gate.promise;
      return open(data, binary);
    });
    const h = harness({ open: opener });
    h.send(arrayBufferToBase64(frame("first", 1)));
    h.send(JSON.stringify({ type: "e2ee_ready" }));
    h.send(frame("second", 2));
    await vi.waitFor(() => expect(opener).toHaveBeenCalledTimes(1));
    expect(h.deliver).not.toHaveBeenCalled();
    gate.resolve();
    await vi.waitFor(() => expect(h.deliver).toHaveBeenCalledTimes(2));
    expect(h.deliver.mock.calls[0][0]).toBe("first");
    expect(new TextDecoder().decode(h.deliver.mock.calls[1][0])).toBe("second");
    expect(h.transport.close).not.toHaveBeenCalled();
  });
  it("poisons queued frames on the first MAC/worker failure without sync retry", async () => {
    const gate = deferred<ReturnType<typeof open>>();
    const opener = vi.fn(() => gate.promise);
    const h = harness({ open: opener });
    h.send(frame("valid but native failed", 1));
    h.send(frame("later", 2));
    await vi.waitFor(() => expect(opener).toHaveBeenCalledTimes(1));
    gate.reject(new Error("worker failed"));
    await vi.waitFor(() =>
      expect(h.transport.close).toHaveBeenCalledWith(1011, "Encrypted receive failed"),
    );
    expect(opener).toHaveBeenCalledTimes(1);
    expect(h.deliver).not.toHaveBeenCalled();
  });
  it.each(["local", "transport"])(
    "discards in-flight result and queued input after %s close",
    async (kind) => {
      const gate = deferred<ReturnType<typeof open>>();
      const opener = vi.fn(() => gate.promise);
      const h = harness({ open: opener });
      const first = frame("first", 1);
      h.send(first);
      h.send(frame("later", 2));
      await vi.waitFor(() => expect(opener).toHaveBeenCalledTimes(1));
      if (kind === "local") h.channel.close();
      else h.transport.onclose?.(1000, "gone");
      gate.resolve(open(first, true));
      await gate.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(h.deliver).not.toHaveBeenCalled();
      expect(opener).toHaveBeenCalledTimes(1);
    },
  );
  it("retains legacy base64-first decoding and never invokes the optional codec", async () => {
    const opener = vi.fn();
    const h = harness({ open: opener }, false);
    h.send(arrayBufferToBase64(frame("legacy", 1)));
    await vi.waitFor(() => expect(h.deliver).toHaveBeenCalledWith("legacy"));
    expect(opener).not.toHaveBeenCalled();
  });
  it("rejects authenticated replay after native MAC verification", async () => {
    const opener = vi.fn<ReceiveCodec["open"]>(async (_key, data, binary) => open(data, binary));
    const h = harness({ open: opener });
    const data = frame("once", 1);
    h.send(data);
    h.send(data);
    await vi.waitFor(() => expect(h.transport.close).toHaveBeenCalled());
    expect(h.deliver).toHaveBeenCalledTimes(1);
    expect(opener).toHaveBeenCalledTimes(2);
  });
  it("copies queued binary input before caller mutation", async () => {
    const gate = deferred<void>();
    const opener = vi.fn<ReceiveCodec["open"]>(async (_key, data, binary) => {
      await gate.promise;
      return open(data, binary);
    });
    const h = harness({ open: opener });
    const data = frame("unchanged", 1);
    h.send(data);
    new Uint8Array(data).fill(0);
    gate.resolve();
    await vi.waitFor(() => expect(h.deliver).toHaveBeenCalledTimes(1));
    expect(new TextDecoder().decode(h.deliver.mock.calls[0][0])).toBe("unchanged");
  });
  it("closes at the frame-count bound, without dropping a frame and continuing", async () => {
    const gate = deferred<ReturnType<typeof open>>();
    const h = harness({ open: () => gate.promise });
    for (let i = 0; i <= RECEIVE_QUEUE_FRAMES; i++) h.send(frame("queued", i + 1));
    expect(h.transport.close).toHaveBeenCalledWith(1011, expect.stringContaining("capacity"));
    gate.resolve(open(frame("late", 1), true));
    await gate.promise;
    expect(h.deliver).not.toHaveBeenCalled();
  });
  it("rejects an oversize frame before codec allocation", () => {
    const opener = vi.fn();
    const h = harness({ open: opener });
    h.send(new ArrayBuffer(RECEIVE_FRAME_BYTES + 1));
    expect(h.transport.close).toHaveBeenCalled();
    expect(opener).not.toHaveBeenCalled();
  });
});

it("bounds retained text bytes across ordinary-size queued frames", async () => {
  const gate = deferred<ReturnType<typeof open>>();
  const h = harness({ open: () => gate.promise });
  const text = "Z".repeat(20 * 1024 * 1024);
  h.send(text);
  h.send(text);
  expect(h.transport.close).toHaveBeenCalledWith(1011, expect.stringContaining("capacity"));
  gate.resolve({ nonce: new ArrayBuffer(24), plaintext: "late" });
  await gate.promise;
  expect(h.deliver).not.toHaveBeenCalled();
});

it("closes the transport with a bounded nonprivate reason for a 124-byte codec error", async () => {
  const h = harness({
    open: async () => {
      throw new Error("x".repeat(124));
    },
  });
  let socketClosed = false;
  vi.mocked(h.transport.close).mockImplementation((_code, reason) => {
    // RN/OkHttp rejects oversized close reasons; the native wrapper swallows it.
    if (new TextEncoder().encode(reason).byteLength <= 123) socketClosed = true;
  });
  h.send(frame("first", 1));
  h.send(frame("later", 2));
  await vi.waitFor(() => expect(h.transport.close).toHaveBeenCalled());
  expect(socketClosed).toBe(true);
  expect(h.transport.close).toHaveBeenCalledWith(1011, "Encrypted receive failed");
  expect(h.deliver).not.toHaveBeenCalled();
});
