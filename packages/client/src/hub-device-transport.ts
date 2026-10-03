import { createClientChannel, type EncryptedChannel, type Transport } from "@clisbot/relay/e2ee";
import {
  HubDeviceRequestSchema,
  HubDeviceResponseSchema,
  isDeviceHubPath,
  type HubDeviceRequest,
  type HubDeviceResponse,
} from "@clisbot/protocol/hub-device-http";
import { toByteArray } from "base64-js";
import type { WebSocketFactory, DaemonTransport } from "./daemon-client-transport-types.js";
import {
  createWebSocketTransportFactory,
  defaultWebSocketFactory,
} from "./daemon-client-websocket-transport.js";

interface PendingRequest {
  resolve(value: HubDeviceResponse): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class HubDeviceTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubDeviceTransportError";
  }
}

/** One pinned E2EE channel for both direct and relay Hub control-plane requests. */
export class HubDeviceTransport {
  private channel: Promise<EncryptedChannel> | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private sequence = 0;
  private base: DaemonTransport | undefined;

  constructor(
    private readonly options: {
      url: string;
      publicKey: string;
      relay?: boolean;
      webSocketFactory?: WebSocketFactory;
      cookies?(values: string[]): Promise<void>;
    },
  ) {}

  async ready(): Promise<void> {
    await this.connect();
  }

  async request(input: Omit<HubDeviceRequest, "type" | "id">): Promise<Response> {
    if (!isDeviceHubPath(input.path)) throw new Error("Unsupported Hub API path");
    HubDeviceRequestSchema.parse({ ...input, type: "hub.http.request", id: "validate" });
    if (new TextEncoder().encode(input.body ?? "").byteLength > 1024 * 1024)
      throw new Error("Hub request body is too large");
    if (this.pending.size >= 16) throw new Error("Too many pending Hub requests");
    const channel = await this.connect();
    if (this.pending.size >= 16) throw new Error("Too many pending Hub requests");
    const id = String(++this.sequence);
    const response = await new Promise<HubDeviceResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HubDeviceTransportError("Hub request timed out"));
        this.close();
      }, 16_000);
      this.pending.set(id, { resolve, reject, timer });
      void channel
        .send(JSON.stringify({ ...input, type: "hub.http.request", id }))
        .catch((error) => this.fail(error));
    });
    if (response.cookies.length) await this.options.cookies?.(response.cookies);
    const bytes = Uint8Array.from(toByteArray(response.body)).buffer;
    return new Response(response.status === 204 || response.status === 304 ? null : bytes, {
      status: response.status,
      headers: response.headers,
    });
  }

  close(): void {
    this.channel = undefined;
    this.base?.close();
    this.base = undefined;
    this.fail(new HubDeviceTransportError("Hub connection closed"));
  }

  private connect(): Promise<EncryptedChannel> {
    if (this.channel) return this.channel;
    const base = (this.base = hubBaseTransport(this.options));
    let ready!: (value: EncryptedChannel) => void;
    let failed!: (error: Error) => void;
    const promise = new Promise<EncryptedChannel>((resolve, reject) => {
      ready = resolve;
      failed = (error) => reject(transportError(error));
    });
    this.channel = promise;
    const current = () => this.channel === promise;
    const timeout = setTimeout(() => {
      failed(new Error("Hub handshake timed out"));
      base.close();
      if (current()) this.channel = undefined;
    }, 8_000);
    const transport = hubWireTransport(base);
    base.onClose(() => {
      clearTimeout(timeout);
      failed(new Error("Hub connection closed"));
      transport.onclose?.(1006, "Transport closed");
      if (current()) {
        this.channel = undefined;
        this.fail(new Error("Hub connection closed"));
      }
    });
    base.onError((error) => {
      failed(error instanceof Error ? error : new Error("Hub transport failed"));
      if (current()) this.fail(error);
      base.close();
    });
    base.onOpen(
      () =>
        void openHubChannel(transport, this.options.publicKey, {
          ready: (value) => {
            clearTimeout(timeout);
            ready(value);
          },
          message: (data) => {
            if (current()) this.receive(data);
          },
          failed: (error) => {
            failed(error);
            if (current()) this.fail(error);
            base.close();
          },
        }),
    );
    return promise;
  }

  private receive(data: string | ArrayBuffer): void {
    try {
      const response = HubDeviceResponseSchema.parse(
        JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data)),
      );
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      pending.resolve(response);
    } catch (error) {
      this.fail(error);
      this.close();
    }
  }

  private fail(error: unknown): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(transportError(error));
    }
    this.pending.clear();
  }
}

function transportError(error: unknown): HubDeviceTransportError {
  return error instanceof HubDeviceTransportError
    ? error
    : new HubDeviceTransportError(error instanceof Error ? error.message : String(error));
}

function hubWireTransport(base: DaemonTransport): Transport {
  const transport: Transport = {
    send: (data) => base.send(data),
    close: (code, reason) => base.close(code, reason),
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  base.onMessage((data, isBinary) =>
    transport.onmessage?.({
      data: typeof data === "string" ? data : (data as ArrayBuffer),
      isBinary,
    }),
  );
  return transport;
}

async function openHubChannel(
  transport: Transport,
  publicKey: string,
  hooks: {
    ready(channel: EncryptedChannel): void;
    message(data: string | ArrayBuffer): void;
    failed(error: Error): void;
  },
): Promise<void> {
  let candidate: EncryptedChannel | undefined;
  let opened = false;
  try {
    candidate = await createClientChannel(transport, publicKey, {
      onopen: () => {
        opened = true;
        if (candidate) hooks.ready(candidate);
      },
      onmessage: hooks.message,
      onerror: hooks.failed,
    });
    if (opened) hooks.ready(candidate);
  } catch (error) {
    hooks.failed(error instanceof Error ? error : new Error("Hub handshake failed"));
  }
}

function hubBaseTransport(options: {
  url: string;
  relay?: boolean;
  webSocketFactory?: WebSocketFactory;
}): DaemonTransport {
  const base = createWebSocketTransportFactory(options.webSocketFactory ?? defaultWebSocketFactory)(
    {
      url: options.url,
      ...(options.relay ? {} : { protocols: ["clisbot.hub.e2ee.v1"] }),
    },
  );
  return base;
}
