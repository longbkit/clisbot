import { expect, test } from "vitest";
import { boundedResponse, HubRequestBudget, untilAborted } from "./bounded-http.js";

test("aborts a hung response read and refuses responses above the byte limit", async () => {
  const abort = new AbortController();
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  const pending = boundedResponse(new Response(body), abort.signal);
  abort.abort(new Error("cancelled"));
  await expect(pending).rejects.toThrow("cancelled");
  expect(cancelled).toBe(true);
  await expect(
    boundedResponse(
      new Response(new Uint8Array(4 * 1024 * 1024 + 1)),
      new AbortController().signal,
    ),
  ).rejects.toThrow("too large");
});

test("a non-cancellable backend retains its budget after the caller times out", async () => {
  const budget = new HubRequestBudget();
  const operations = Array.from({ length: 64 }, () =>
    budget.run(() => new Promise<void>(() => undefined)),
  );
  const abort = new AbortController();
  const response = untilAborted(operations[0]!, abort.signal);
  abort.abort(new Error("timed out"));
  await expect(response).rejects.toThrow("timed out");
  await expect(budget.run(async () => "more")).rejects.toThrow("capacity");
});
