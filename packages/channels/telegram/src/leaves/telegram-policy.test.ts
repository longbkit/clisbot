// L1 transport-policy leaf tests — the injected Bot API fetch. The load-bearing
// case is the body normalization: grammy hands its fetch a Node `Readable`
// multipart body (payload.js `createFormDataPayload` -> `stream.Readable.from`),
// and undici's global fetch cannot transmit a Node `Readable` as `body` — it
// needs a web `ReadableStream`. Every file upload through the injected fetch
// failed until the body was converted (`Readable.toWeb`), while JSON calls
// (string bodies) always worked.

import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createTelegramClientFetch } from "./telegram-policy.js";

/** grammy hands its fetch a Node `Readable` multipart body (payload.js
 * `createFormDataPayload`) — that is exactly what these tests feed the
 * wrapped fetch, so the Node→DOM `BodyInit` boundary is cast at the call
 * site (the wrapped fetch normalizes it back to a web stream). */
const readBody = (r: Readable): BodyInit => r as unknown as BodyInit;

/** Collect an HTTP request body into a string. */
function collectRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let received = "";
    req.on("data", (c) => (received += String(c)));
    req.on("end", () => resolve(received));
  });
}

type SeenInit = { body?: unknown; signal?: unknown } | null | undefined;

/** A base fetch that records what it was called with and resolves a Response. */
function recordingFetch(seen: { init: SeenInit }): typeof globalThis.fetch {
  return (async (_input, init) => {
    seen.init = init;
    return new Response("ok");
  }) as typeof globalThis.fetch;
}

async function collectBody(body: unknown): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as ReadableStream<Uint8Array>) {
    chunks.push(chunk as Uint8Array);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

describe("createTelegramClientFetch — Node Readable body normalization", () => {
  it("converts a Node Readable body to a web ReadableStream (timeout branch)", async () => {
    const seen: { init: SeenInit } = { init: undefined };
    const fetchFn = createTelegramClientFetch({
      timeoutSeconds: 5,
      transport: { fetch: recordingFetch(seen) },
    });
    const body = Readable.from([Buffer.from("multipart-chunk-1")]);
    await fetchFn("https://api.test/sendPhoto", { method: "POST", body: readBody(body) });

    const init = seen.init as { body: unknown };
    expect(init.body).toBeInstanceOf(ReadableStream);
    expect(init.body).not.toBeInstanceOf(Readable);
    expect(await collectBody(init.body)).toEqual(new TextEncoder().encode("multipart-chunk-1"));
  });

  it("converts a Node Readable body in the no-timeout passthrough branch", async () => {
    const seen: { init: SeenInit } = { init: undefined };
    const fetchFn = createTelegramClientFetch({
      transport: { fetch: recordingFetch(seen) },
    });
    await fetchFn("https://api.test/sendDocument", {
      method: "POST",
      body: readBody(Readable.from([Buffer.from("doc-bytes")])),
    });

    const init = seen.init as { body: unknown };
    expect(init.body).toBeInstanceOf(ReadableStream);
    expect(await collectBody(init.body)).toEqual(new TextEncoder().encode("doc-bytes"));
  });

  it("passes a string JSON body through untouched", async () => {
    const seen: { init: SeenInit } = { init: undefined };
    const fetchFn = createTelegramClientFetch({
      timeoutSeconds: 5,
      transport: { fetch: recordingFetch(seen) },
    });
    await fetchFn("https://api.test/getMe", { method: "POST", body: '{"json":true}' });
    expect((seen.init as { body: unknown }).body).toBe('{"json":true}');
  });

  it("leaves a body-less request without a body field", async () => {
    const seen: { init: SeenInit } = { init: undefined };
    const fetchFn = createTelegramClientFetch({
      timeoutSeconds: 5,
      transport: { fetch: recordingFetch(seen) },
    });
    await fetchFn("https://api.test/getMe");
    expect("body" in (seen.init ?? {})).toBe(false);
  });

  it("end to end: the wrapped fetch transmits a Node Readable body through undici", async () => {
    let received = "";
    const server = createServer(async (req, res) => {
      received = await collectRequestBody(req);
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const fetchFn = createTelegramClientFetch({ timeoutSeconds: 5 });
      const res = await fetchFn(`http://127.0.0.1:${port}/upload`, {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=x" },
        body: readBody(
          Readable.from([
            Buffer.from("--x\r\ncontent-type: image/png\r\n\r\n"),
            Buffer.from("binary-bytes"),
            Buffer.from("\r\n--x--\r\n"),
          ]),
        ),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(received).toContain("binary-bytes");
      expect(received).toContain("--x--");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("still aborts with the timeout error when the base fetch hangs", async () => {
    // Undici-shaped base: rejects when the passed signal aborts.
    const base = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const sig = init?.signal;
        if (sig?.aborted) reject(sig.reason);
        else sig?.addEventListener("abort", () => reject(sig.reason), { once: true });
      });
    }) as typeof globalThis.fetch;
    const fetchFn = createTelegramClientFetch({
      timeoutSeconds: 0.05,
      transport: { fetch: base },
    });
    await expect(
      fetchFn("https://api.test/slow", { method: "POST", body: "ping" }),
    ).rejects.toThrow(/timed out after 50ms/);
  });
});
