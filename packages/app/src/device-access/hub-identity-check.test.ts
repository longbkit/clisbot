import { afterEach, expect, it, vi } from "vitest";
import { fetchPublicHubIdentity, inspectHubIdentity } from "./hub-identity-check";

const saved = {
  hubId: "personal-hub",
  publicKey: "saved-key",
  origin: "https://hub.example.test",
};
const response = (identity: unknown) => new Response(JSON.stringify(identity));
afterEach(() => vi.useRealTimers());

it("maps a connection deadline to retry guidance instead of the raw abort reason", async () => {
  vi.useFakeTimers();
  const fetchIdentity = vi.fn(
    (_url: unknown, input?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        input?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("signal is aborted without reason", "AbortError")),
          { once: true },
        );
      }),
  );
  const pending = fetchPublicHubIdentity(saved.origin, fetchIdentity);
  const rejected = expect(pending).rejects.toThrow(/^Connection timed out\. Check the Hub address/);
  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps the deadline through a stalled metadata body and does not persist any trust", async () => {
  vi.useFakeTimers();
  const fetchIdentity = vi.fn(
    async (_url: unknown, input?: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            input?.signal?.addEventListener(
              "abort",
              () => controller.error(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          },
        }),
      ),
  );
  const rejected = expect(fetchPublicHubIdentity(saved.origin, fetchIdentity)).rejects.toThrow(
    /^Connection timed out/,
  );
  await vi.advanceTimersByTimeAsync(10_000);
  await rejected;
  expect(saved.publicKey).toBe("saved-key");
  expect(vi.getTimerCount()).toBe(0);
});

it("reports malformed responses and network failures without surfacing browser internals", async () => {
  await expect(
    fetchPublicHubIdentity(
      saved.origin,
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    ),
  ).rejects.toThrow(/^Could not reach this Hub/);
  await expect(
    fetchPublicHubIdentity(
      saved.origin,
      vi.fn(async () => new Response("not JSON")),
    ),
  ).rejects.toThrow(/^This address did not return a valid Hub response/);
  expect(
    await inspectHubIdentity(
      saved,
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    ),
  ).toBeNull();
});

it("reads only public metadata without cookies, device proofs, grants, or redirect following", async () => {
  const fetchIdentity = vi.fn(async () =>
    response({
      hubId: "changed-hub",
      publicKey: "changed-key",
      ownerSetupToken: "ignore",
    }),
  );
  const result = await inspectHubIdentity(saved, fetchIdentity);
  expect(result).toEqual({
    saved: { hubId: saved.hubId, publicKey: saved.publicKey },
    observed: { hubId: "changed-hub", publicKey: "changed-key" },
  });
  const [url, input] = fetchIdentity.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.href).toBe("https://hub.example.test/api/auth/clisbot/device/identity");
  expect(input).toEqual({
    credentials: "omit",
    redirect: "error",
    signal: expect.any(AbortSignal),
  });
  expect(saved.publicKey).toBe("saved-key");
});

it("does not flag the same Hub identity or create a trust update", async () => {
  expect(
    await inspectHubIdentity(
      saved,
      vi.fn(async () => response(saved)),
    ),
  ).toBeNull();
});

it("detects a changed key even when the Hub ID remains the same", async () => {
  expect(
    await inspectHubIdentity(
      saved,
      vi.fn(async () => response({ ...saved, publicKey: "replacement-key" })),
    ),
  ).toMatchObject({
    saved: { publicKey: "saved-key" },
    observed: { hubId: "personal-hub", publicKey: "replacement-key" },
  });
});

it("does not contact a relay-only profile, unsafe remote HTTP URL, or URL with credentials", async () => {
  const fetchIdentity = vi.fn();
  for (const origin of [undefined, "http://remote.test", "https://user:secret@hub.test"])
    expect(await inspectHubIdentity({ ...saved, origin }, fetchIdentity)).toBeNull();
  expect(fetchIdentity).not.toHaveBeenCalled();
});

it("keeps malformed metadata and network failures in the existing connection recovery", async () => {
  expect(
    await inspectHubIdentity(
      saved,
      vi.fn(async () => response({ hubId: "different" })),
    ),
  ).toBeNull();
  expect(
    await inspectHubIdentity(
      saved,
      vi.fn(async () => {
        throw new Error("offline");
      }),
    ),
  ).toBeNull();
  expect(
    await inspectHubIdentity(
      saved,
      vi.fn(async () => ({ ok: false }) as Response),
    ),
  ).toBeNull();
});

it("rejects an oversized advertised body before reading and cancels it", async () => {
  const cancelled = vi.fn();
  const body = new ReadableStream({ cancel: cancelled });
  const fetchIdentity = vi.fn(
    async () => new Response(body, { headers: { "content-length": "8193" } }),
  );
  expect(await inspectHubIdentity(saved, fetchIdentity)).toBeNull();
  expect(cancelled).toHaveBeenCalledOnce();
});

it("bounds streamed metadata without trusting Content-Length and cancels on overflow", async () => {
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(8193));
    },
    cancel: cancelled,
  });
  expect(
    await inspectHubIdentity(
      saved,
      vi.fn(async () => new Response(body)),
    ),
  ).toBeNull();
  expect(cancelled).toHaveBeenCalledOnce();
});

it("bounds UTF-8 bytes on native text-only responses", async () => {
  const body = JSON.stringify({
    ...saved,
    publicKey: "changed-key",
    ignored: "é".repeat(5000),
  });
  const nativeResponse = {
    ok: true,
    headers: new Headers(),
    body: null,
    text: async () => body,
  } as Response;
  expect(
    await inspectHubIdentity(
      saved,
      vi.fn(async () => nativeResponse),
    ),
  ).toBeNull();
});
