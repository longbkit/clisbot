import { afterEach, expect, it, vi } from "vitest";
import { classifyHubFailure, HubApiError } from "../api-client";
import { fetchWithDeadline, HubUnreachableError, withDeadline } from "./request-deadline";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A fetch that never answers until its signal aborts, like a Hub behind a VPN that is off. */
function silentFetch() {
  return vi.fn(
    (_url: URL | string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted")));
      }),
  );
}

it("settles a request the Hub never answers as unreachable after the deadline", async () => {
  vi.useFakeTimers();
  const fetch = silentFetch();
  vi.stubGlobal("fetch", fetch);
  const request = fetchWithDeadline("https://hub.example.test/api/x", { method: "GET" }, 15_000);
  const settled = expect(request).rejects.toThrow(
    new HubUnreachableError("The Hub did not answer within 15 s"),
  );
  await vi.advanceTimersByTimeAsync(14_999);
  expect(fetch.mock.calls[0]![1]!.signal!.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await settled;
  expect(classifyHubFailure(await request.catch((error: unknown) => error))).toBe("unreachable");
});

it("keeps the deadline through a body that stalls after the headers", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: URL | string, init?: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
        },
      });
      return new Response(body, { status: 200 });
    }),
  );
  const request = fetchWithDeadline("https://hub.example.test/api/x", {}, 1_000);
  const settled = expect(request).rejects.toBeInstanceOf(HubUnreachableError);
  await vi.advanceTimersByTimeAsync(1_000);
  await settled;
});

it("reports a refused connection as unreachable and returns readable answers", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce(Response.json({ ok: true }, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })),
  );
  await expect(fetchWithDeadline("https://hub.example.test/api/x", {})).rejects.toThrow(
    new HubUnreachableError("Network request failed"),
  );
  const created = await fetchWithDeadline("https://hub.example.test/api/x", {});
  expect({ status: created.status, body: await created.json() }).toEqual({
    status: 201,
    body: { ok: true },
  });
  expect((await fetchWithDeadline("https://hub.example.test/api/x", {})).status).toBe(204);
});

it("stops waiting on a request that cannot be aborted", async () => {
  vi.useFakeTimers();
  const request = withDeadline(new Promise<never>(() => undefined), 2_000);
  const settled = expect(request).rejects.toBeInstanceOf(HubUnreachableError);
  await vi.advanceTimersByTimeAsync(2_000);
  await settled;
});

it("classifies only explicit Hub answers as sign-in or revocation", () => {
  expect(classifyHubFailure(new HubApiError(401, "unauthorized", "x"))).toBe("needs-sign-in");
  expect(classifyHubFailure(new HubApiError(403, "forbidden", "x"))).toBe("revoked");
  expect(classifyHubFailure(new HubApiError(503, "unavailable", "x"))).toBe("unreachable");
  expect(classifyHubFailure(new HubApiError(404, "not_found", "x"))).toBe("unreachable");
  expect(classifyHubFailure(new HubUnreachableError("offline"))).toBe("unreachable");
  expect(classifyHubFailure(new Error("boom"))).toBe("unreachable");
});
