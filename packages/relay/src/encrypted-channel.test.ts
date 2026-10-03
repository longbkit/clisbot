import { describe, it, expect, vi } from "vitest";
import {
  createClientChannel,
  createDaemonChannel,
  EncryptedChannel,
  Transport,
} from "./encrypted-channel.js";
import {
  deriveSharedKey,
  encrypt,
  encryptWithNonce,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
} from "./crypto.js";
import { arrayBufferToBase64 } from "./base64.js";

/**
 * Creates a pair of connected mock transports.
 * Messages sent on one are received on the other.
 */
function createMockTransportPair(): [Transport, Transport] {
  const transportA: Transport = {
    send: vi.fn(),
    close: vi.fn(),
    onmessage: null,
    onclose: null,
    onerror: null,
  };

  const transportB: Transport = {
    send: vi.fn(),
    close: vi.fn(),
    onmessage: null,
    onclose: null,
    onerror: null,
  };

  // Wire them together
  (transportA.send as ReturnType<typeof vi.fn>).mockImplementation((data: string | ArrayBuffer) => {
    setTimeout(() => transportB.onmessage?.({ data, isBinary: data instanceof ArrayBuffer }), 0);
  });

  (transportB.send as ReturnType<typeof vi.fn>).mockImplementation((data: string | ArrayBuffer) => {
    setTimeout(() => transportA.onmessage?.({ data, isBinary: data instanceof ArrayBuffer }), 0);
  });

  return [transportA, transportB];
}

async function waitForAsyncDelivery(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("EncryptedChannel", () => {
  it("rejects the daemon handshake when the ready frame fails to send", async () => {
    const daemonKeyPair = generateKeyPair();
    const clientKeyPair = generateKeyPair();
    const transport: Transport = {
      send: () => Promise.reject(new Error("ready send failed")),
      close: () => undefined,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    const channel = createDaemonChannel(transport, daemonKeyPair);

    transport.onmessage?.({
      data: JSON.stringify({
        type: "e2ee_hello",
        key: exportPublicKey(clientKeyPair.publicKey),
      }),
      isBinary: false,
    });

    await expect(channel).rejects.toThrow("ready send failed");
  });

  it("waits for transport send completion", async () => {
    let completeSend: (() => void) | undefined;
    const transport: Transport = {
      send: () =>
        new Promise<void>((resolve) => {
          completeSend = resolve;
        }),
      close: () => undefined,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    const first = generateKeyPair();
    const second = generateKeyPair();
    const channel = new EncryptedChannel(
      transport,
      deriveSharedKey(first.secretKey, second.publicKey),
      {},
      { binaryCiphertext: true },
    );
    channel.setState("open");
    let completed = false;

    const sending = channel.send(new Uint8Array([1, 2, 3]).buffer).then(() => {
      completed = true;
      return undefined;
    });
    await Promise.resolve();
    expect(completed).toBe(false);

    completeSend?.();
    await sending;
    expect(completed).toBe(true);
  });

  it("establishes encrypted channel between daemon and client", async () => {
    const [daemonTransport, clientTransport] = createMockTransportPair();

    // Daemon generates keypair (public key goes in QR)
    const daemonKeyPair = generateKeyPair();
    const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);

    let clientOpenedResolve: (() => void) | null = null;
    const clientOpened = new Promise<void>((resolve) => {
      clientOpenedResolve = resolve;
    });

    // Start daemon waiting for client
    const daemonChannelPromise = createDaemonChannel(daemonTransport, daemonKeyPair);

    // Client connects (scanned QR, got daemon's public key)
    const clientChannel = await createClientChannel(clientTransport, daemonPubKeyB64, {
      onopen: () => clientOpenedResolve?.(),
    });

    // Daemon receives hello and completes handshake
    const daemonChannel = await daemonChannelPromise;
    await clientOpened;

    expect(clientChannel.isOpen()).toBe(true);
    expect(daemonChannel.isOpen()).toBe(true);
  });

  it("exchanges encrypted messages bidirectionally", async () => {
    const [daemonTransport, clientTransport] = createMockTransportPair();

    const daemonKeyPair = generateKeyPair();
    const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);

    const daemonMessages: (string | ArrayBuffer)[] = [];
    const clientMessages: (string | ArrayBuffer)[] = [];

    let clientOpenedResolve: (() => void) | null = null;
    const clientOpened = new Promise<void>((resolve) => {
      clientOpenedResolve = resolve;
    });

    const daemonChannelPromise = createDaemonChannel(daemonTransport, daemonKeyPair, {
      onmessage: (data) => daemonMessages.push(data),
    });

    const clientChannel = await createClientChannel(clientTransport, daemonPubKeyB64, {
      onmessage: (data) => clientMessages.push(data),
      onopen: () => clientOpenedResolve?.(),
    });

    const daemonChannel = await daemonChannelPromise;
    await clientOpened;

    // Send messages both directions
    await clientChannel.send("Hello from client");
    await daemonChannel.send("Hello from daemon");
    await clientChannel.send("Second message from client");

    // Wait for async delivery
    await waitForAsyncDelivery();

    expect(daemonMessages).toEqual(["Hello from client", "Second message from client"]);
    expect(clientMessages).toEqual(["Hello from daemon"]);
  });

  it("encrypted messages are opaque to transport", async () => {
    const [daemonTransport, clientTransport] = createMockTransportPair();

    const daemonKeyPair = generateKeyPair();
    const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);

    let clientOpenedResolve: (() => void) | null = null;
    const clientOpened = new Promise<void>((resolve) => {
      clientOpenedResolve = resolve;
    });

    const daemonChannelPromise = createDaemonChannel(daemonTransport, daemonKeyPair);
    const clientChannel = await createClientChannel(clientTransport, daemonPubKeyB64, {
      onopen: () => clientOpenedResolve?.(),
    });
    await daemonChannelPromise;
    await clientOpened;

    // Clear mock call history
    (clientTransport.send as ReturnType<typeof vi.fn>).mockClear();

    // Send a plaintext message
    const plaintext = "Secret message";
    await clientChannel.send(plaintext);

    // Check what was actually sent over the transport
    expect(clientTransport.send).toHaveBeenCalledTimes(1);
    const sentData = (clientTransport.send as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Should be base64 string (encrypted)
    expect(typeof sentData).toBe("string");
    // Should NOT contain the plaintext
    expect(sentData).not.toContain(plaintext);
    // Should be significantly longer than plaintext (IV + auth tag overhead)
    expect(sentData.length).toBeGreaterThan(plaintext.length + 20);
  });

  it("does not throw uncaught when handshake hello retry send fails", async () => {
    vi.useFakeTimers();
    try {
      const daemonKeyPair = generateKeyPair();
      const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);

      const transport: Transport = {
        send: vi.fn(),
        close: vi.fn(),
        onmessage: null,
        onclose: null,
        onerror: null,
      };

      let sendAttempts = 0;
      (transport.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
        sendAttempts += 1;
        if (sendAttempts >= 2) {
          throw new Error("WebSocket not open (readyState=2)");
        }
      });

      const onerror = vi.fn();
      await createClientChannel(transport, daemonPubKeyB64, { onerror });

      expect(() => {
        vi.advanceTimersByTime(1000);
      }).not.toThrow();

      expect(onerror).toHaveBeenCalledTimes(1);
      expect(onerror.mock.calls[0][0]).toBeInstanceOf(Error);
      expect((onerror.mock.calls[0][0] as Error).message).toContain("WebSocket not open");

      // Close the transport to stop retry timer.
      transport.onclose?.(1000, "closed");
      vi.runOnlyPendingTimers();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports rejected handshake hello sends", async () => {
    const daemonKeyPair = generateKeyPair();
    const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);
    const transport: Transport = {
      send: () => Promise.reject(new Error("hello send failed")),
      close: vi.fn(),
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    const onerror = vi.fn();

    await createClientChannel(transport, daemonPubKeyB64, { onerror });
    await Promise.resolve();

    expect(onerror).toHaveBeenCalledTimes(1);
    expect((onerror.mock.calls[0][0] as Error).message).toBe("hello send failed");
    transport.onclose?.(1000, "closed");
  });

  it("reports rejected sends while flushing the handshake backlog", async () => {
    const daemonKeyPair = generateKeyPair();
    const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);
    let sendAttempts = 0;
    const transport: Transport = {
      send: () => {
        sendAttempts += 1;
        return sendAttempts === 1 ? undefined : Promise.reject(new Error("backlog send failed"));
      },
      close: vi.fn(),
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    const onerror = vi.fn();
    const channel = await createClientChannel(transport, daemonPubKeyB64, { onerror });
    await channel.send(new ArrayBuffer(8));

    transport.onmessage?.({
      data: JSON.stringify({
        type: "e2ee_ready",
        capabilities: { binaryCiphertext: true },
      }),
      isBinary: false,
    });
    await waitForAsyncDelivery();

    expect(onerror).toHaveBeenCalledTimes(1);
    expect((onerror.mock.calls[0][0] as Error).message).toBe("backlog send failed");
    expect(transport.close).toHaveBeenCalledWith(1011, "backlog send failed");
  });

  it("fails handshake on invalid hello", async () => {
    const [daemonTransport] = createMockTransportPair();

    const daemonKeyPair = generateKeyPair();

    const daemonChannelPromise = createDaemonChannel(daemonTransport, daemonKeyPair);

    // Send invalid hello
    setTimeout(() => {
      daemonTransport.onmessage?.({ data: '{"type":"invalid"}', isBinary: false });
    }, 0);

    await expect(daemonChannelPromise).rejects.toThrow("Invalid hello message");
  });

  it("accepts duplicate hello from the same client without re-keying", async () => {
    const [daemonTransport, clientTransport] = createMockTransportPair();

    const daemonKeyPair = generateKeyPair();
    const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);
    const daemonMessages: (string | ArrayBuffer)[] = [];

    let clientOpenedResolve: (() => void) | null = null;
    const clientOpened = new Promise<void>((resolve) => {
      clientOpenedResolve = resolve;
    });

    const daemonChannelPromise = createDaemonChannel(daemonTransport, daemonKeyPair, {
      onmessage: (data) => daemonMessages.push(data),
    });

    const clientChannel = await createClientChannel(clientTransport, daemonPubKeyB64, {
      onopen: () => clientOpenedResolve?.(),
    });

    await daemonChannelPromise;
    await clientOpened;

    const firstHello = (clientTransport.send as ReturnType<typeof vi.fn>).mock.calls.find(
      ([data]) => typeof data === "string" && data.includes('"type":"e2ee_hello"'),
    )?.[0];
    expect(typeof firstHello).toBe("string");

    daemonTransport.onmessage?.({ data: firstHello as string, isBinary: false });
    await waitForAsyncDelivery();

    expect(daemonTransport.close).not.toHaveBeenCalled();

    await clientChannel.send("still encrypted with original key");
    await waitForAsyncDelivery();

    expect(daemonMessages).toEqual(["still encrypted with original key"]);
  });

  it("closes an open daemon channel when a different client key sends hello", async () => {
    const [daemonTransport, clientTransport] = createMockTransportPair();

    const daemonKeyPair = generateKeyPair();
    const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);

    let clientOpenedResolve: (() => void) | null = null;
    const clientOpened = new Promise<void>((resolve) => {
      clientOpenedResolve = resolve;
    });

    const daemonChannelPromise = createDaemonChannel(daemonTransport, daemonKeyPair);

    await createClientChannel(clientTransport, daemonPubKeyB64, {
      onopen: () => clientOpenedResolve?.(),
    });

    await daemonChannelPromise;
    await clientOpened;

    const attackerKeyPair = generateKeyPair();
    const attackerHello = JSON.stringify({
      type: "e2ee_hello",
      key: exportPublicKey(attackerKeyPair.publicKey),
    });

    daemonTransport.onmessage?.({ data: attackerHello, isBinary: false });
    await waitForAsyncDelivery();

    expect(daemonTransport.close).toHaveBeenCalledWith(1008, "E2EE re-handshake key mismatch");
  });

  it("preserves ASCII-only binary frames in negotiated mode", async () => {
    const [daemonTransport, clientTransport] = createMockTransportPair();
    const daemonKeyPair = generateKeyPair();
    const daemonMessages: (string | ArrayBuffer)[] = [];
    let resolveOpen: (() => void) | null = null;
    const opened = new Promise<void>((resolve) => {
      resolveOpen = resolve;
    });

    const daemonChannelPromise = createDaemonChannel(daemonTransport, daemonKeyPair, {
      onmessage: (data) => daemonMessages.push(data),
    });
    const clientChannel = await createClientChannel(
      clientTransport,
      exportPublicKey(daemonKeyPair.publicKey),
      { onopen: () => resolveOpen?.() },
    );
    await daemonChannelPromise;
    await opened;

    const binary = new TextEncoder().encode("ASCII terminal output").buffer;
    (clientTransport.send as ReturnType<typeof vi.fn>).mockClear();
    await clientChannel.send(binary);
    await waitForAsyncDelivery();

    const ciphertext = (clientTransport.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(ciphertext).toBeInstanceOf(ArrayBuffer);
    expect((ciphertext as ArrayBuffer).byteLength).toBe(binary.byteLength + 40);
    expect(daemonMessages[0]).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(daemonMessages[0] as ArrayBuffer)).toEqual(new Uint8Array(binary));
  });

  it("keeps negotiated text as base64 text frames", async () => {
    const [daemonTransport, clientTransport] = createMockTransportPair();
    const daemonKeyPair = generateKeyPair();
    const daemonMessages: (string | ArrayBuffer)[] = [];
    let resolveOpen: (() => void) | null = null;
    const opened = new Promise<void>((resolve) => {
      resolveOpen = resolve;
    });
    const daemonChannelPromise = createDaemonChannel(daemonTransport, daemonKeyPair, {
      onmessage: (data) => daemonMessages.push(data),
    });
    const clientChannel = await createClientChannel(
      clientTransport,
      exportPublicKey(daemonKeyPair.publicKey),
      { onopen: () => resolveOpen?.() },
    );
    await daemonChannelPromise;
    await opened;

    (clientTransport.send as ReturnType<typeof vi.fn>).mockClear();
    await clientChannel.send("text payload");
    await waitForAsyncDelivery();

    expect(typeof (clientTransport.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "string",
    );
    expect(daemonMessages).toEqual(["text payload"]);
  });

  it("new client stays base64-only when an old daemon does not accept the capability", async () => {
    const daemonKeyPair = generateKeyPair();
    const clientTransport: Transport = {
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    let resolveOpen: (() => void) | null = null;
    const opened = new Promise<void>((resolve) => {
      resolveOpen = resolve;
    });
    const clientChannel = await createClientChannel(
      clientTransport,
      exportPublicKey(daemonKeyPair.publicKey),
      { onopen: () => resolveOpen?.() },
    );

    const hello = JSON.parse(
      (clientTransport.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string,
    ) as { key: string };
    expect(hello).toMatchObject({ capabilities: { binaryCiphertext: true } });
    clientTransport.onmessage?.({ data: JSON.stringify({ type: "e2ee_ready" }), isBinary: false });
    await opened;

    (clientTransport.send as ReturnType<typeof vi.fn>).mockClear();
    await clientChannel.send(new TextEncoder().encode("legacy binary").buffer);
    expect(typeof (clientTransport.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "string",
    );
  });

  it("new daemon stays base64-only for an old client and drains pipelined traffic", async () => {
    const daemonKeyPair = generateKeyPair();
    const clientKeyPair = generateKeyPair();
    const daemonMessages: (string | ArrayBuffer)[] = [];
    const daemonTransport: Transport = {
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    const channelPromise = createDaemonChannel(daemonTransport, daemonKeyPair, {
      onmessage: (data) => daemonMessages.push(data),
    });
    const sharedKey = deriveSharedKey(
      clientKeyPair.secretKey,
      importPublicKey(exportPublicKey(daemonKeyPair.publicKey)),
    );
    daemonTransport.onmessage?.({
      data: JSON.stringify({
        type: "e2ee_hello",
        key: exportPublicKey(clientKeyPair.publicKey),
      }),
      isBinary: false,
    });
    daemonTransport.onmessage?.({
      data: arrayBufferToBase64(encrypt(sharedKey, "pipelined legacy text")),
      isBinary: false,
    });

    const daemonChannel = await channelPromise;
    await waitForAsyncDelivery();
    expect(daemonMessages).toEqual(["pipelined legacy text"]);
    expect(
      JSON.parse((daemonTransport.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]),
    ).toEqual({
      type: "e2ee_ready",
    });

    (daemonTransport.send as ReturnType<typeof vi.fn>).mockClear();
    await daemonChannel.send(new Uint8Array([1, 2, 3]).buffer);
    expect(typeof (daemonTransport.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "string",
    );
  });
});

describe("security review: ciphertext replay", () => {
  it.each([false, true])(
    "rejects duplicate ciphertext before dispatch (binary=%s)",
    async (binary) => {
      const [daemonTransport, clientTransport] = createMockTransportPair();
      const key = generateKeyPair();
      const delivered: (string | ArrayBuffer)[] = [];
      const daemonReady = createDaemonChannel(daemonTransport, key, {
        onmessage: (data) => delivered.push(data),
      });
      const client = await createClientChannel(clientTransport, exportPublicKey(key.publicKey));
      const daemon = await daemonReady;
      await waitForAsyncDelivery();
      try {
        const payload = binary ? new Uint8Array([7, 8, 9]).buffer : "terminal command";
        await client.send(payload);
        await waitForAsyncDelivery();
        const calls = (clientTransport.send as ReturnType<typeof vi.fn>).mock.calls;
        const wire = calls[calls.length - 1][0] as string | ArrayBuffer;
        daemonTransport.onmessage?.({ data: wire, isBinary: wire instanceof ArrayBuffer });
        daemonTransport.onmessage?.({ data: wire, isBinary: wire instanceof ArrayBuffer });
        await waitForAsyncDelivery();
        expect(delivered).toHaveLength(1);
        expect(daemonTransport.close).toHaveBeenCalled();
        expect(daemon.isOpen()).toBe(false);
      } finally {
        client.close();
        daemon.close();
      }
    },
  );
});

describe("security review: channel resource and nonce boundaries", () => {
  function transport(): Transport {
    return { send: vi.fn(), close: vi.fn(), onmessage: null, onclose: null, onerror: null };
  }

  function channels() {
    const one = generateKeyPair();
    const two = generateKeyPair();
    const key = deriveSharedKey(one.secretKey, two.publicKey);
    const sent = transport();
    const received = transport();
    const messages: (string | ArrayBuffer)[] = [];
    const sender = new EncryptedChannel(sent, key, {}, { binaryCiphertext: true });
    const receiver = new EncryptedChannel(
      received,
      key,
      { onmessage: (data) => messages.push(data) },
      { binaryCiphertext: true },
    );
    sender.setState("open");
    receiver.setState("open");
    const deliver = (data: string | ArrayBuffer) =>
      received.onmessage?.({ data, isBinary: data instanceof ArrayBuffer });
    return { sender, receiver, sent, received, messages, deliver, key };
  }

  it("accepts legacy random nonces but rejects replay through another WebSocket opcode", async () => {
    const f = channels();
    const frames = [1, 2, 3].map((n) => encrypt(f.key, String(n)));
    for (const frame of frames) f.deliver(arrayBufferToBase64(frame));
    await waitForAsyncDelivery();
    expect(f.messages).toEqual(["1", "2", "3"]);
    f.deliver(frames[0]);
    await waitForAsyncDelivery();
    expect(f.messages).toHaveLength(3);
    expect(f.receiver.isOpen()).toBe(false);
  });

  it("supports long modern sessions without evicting replay state", async () => {
    const f = channels();
    for (let n = 0; n < 5000; n++) {
      await f.sender.send(String(n));
      const calls = (f.sent.send as ReturnType<typeof vi.fn>).mock.calls;
      f.deliver(calls[n][0] as string);
    }
    await waitForAsyncDelivery();
    expect(f.messages).toHaveLength(5000);
    expect(f.receiver.isOpen()).toBe(true);
    const first = (f.sent.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    f.deliver(first);
    await waitForAsyncDelivery();
    expect(f.messages).toHaveLength(5000);
    expect(f.receiver.isOpen()).toBe(false);
  });

  it("closes at the legacy nonce budget instead of evicting old replay evidence", async () => {
    const f = channels();
    for (let n = 0; n < 4097; n++) {
      const nonce = new Uint8Array(24);
      new DataView(nonce.buffer).setUint32(0, n);
      nonce[23] = 1;
      f.deliver(arrayBufferToBase64(encryptWithNonce(f.key, String(n), nonce)));
    }
    await waitForAsyncDelivery();
    expect(f.messages).toHaveLength(4096);
    expect(f.receiver.isOpen()).toBe(false);
    expect(f.received.close).toHaveBeenCalledWith(1011, expect.stringContaining("capacity"));
  });

  it("rejects reflected ciphertext, reordered counters and queued traffic after failure", async () => {
    const f = channels();
    await f.sender.send("first");
    await f.sender.send("second");
    await f.sender.send("third");
    const calls = (f.sent.send as ReturnType<typeof vi.fn>).mock.calls;
    f.deliver(calls[1][0] as string);
    f.deliver(calls[0][0] as string);
    f.deliver(calls[2][0] as string);
    await waitForAsyncDelivery();
    expect(f.messages).toEqual(["second"]);
    expect(f.receiver.isOpen()).toBe(false);
    f.sent.onmessage?.({ data: calls[0][0] as string, isBinary: false });
    await waitForAsyncDelivery();
    expect(f.sender.isOpen()).toBe(false);
    expect(f.sent.close).toHaveBeenCalledWith(1011, "Reflected encrypted frame");
  });

  it.each([false, true])(
    "bounds frames buffered while ready is blocked and never revives a rejected handshake (large=%s)",
    async (large) => {
      const wire = transport();
      let ready!: () => void;
      wire.send = () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        });
      const waiting = createDaemonChannel(wire, generateKeyPair());
      wire.onmessage?.({
        data: JSON.stringify({
          type: "e2ee_hello",
          key: exportPublicKey(generateKeyPair().publicKey),
        }),
        isBinary: false,
      });
      for (let n = 0; n < (large ? 1 : 65); n++)
        wire.onmessage?.({
          data: large ? "x".repeat(1024 * 1024 + 1) : "buffered",
          isBinary: false,
        });
      const rejected = expect(waiting).rejects.toThrow("handshake buffer");
      ready();
      await rejected;
      expect(wire.close).toHaveBeenCalledWith(1008, expect.stringContaining("handshake buffer"));
    },
  );
});
