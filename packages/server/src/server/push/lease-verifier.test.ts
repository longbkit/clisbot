import { describe, expect, test } from "vitest";

import { LeaseVerificationUnavailableError, LeaseVerifier } from "./lease-verifier.js";

function hub() {
  const answers = new Map<string, (() => void)[]>();
  let inFlight = 0;
  const state = { requests: [] as string[], peak: 0 };
  const request = (leaseId: string) => {
    state.requests.push(leaseId);
    inFlight += 1;
    state.peak = Math.max(state.peak, inFlight);
    return new Promise<string>((resolve) => {
      answers.set(leaseId, [
        ...(answers.get(leaseId) ?? []),
        () => {
          inFlight -= 1;
          resolve(`granted:${leaseId}`);
        },
      ]);
    });
  };
  const answer = (leaseId: string) => answers.get(leaseId)?.shift()?.();
  return { state, request, answer };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("lease verifier", () => {
  test("notifications asking about one lease together share one Hub request; later ones ask again", async () => {
    const verifier = new LeaseVerifier<string>();
    const fake = hub();

    const together = [1, 2, 3].map(() => verifier.verify("lease-a", fake.request));
    fake.answer("lease-a");
    expect(await Promise.all(together)).toEqual(Array(3).fill("granted:lease-a"));

    const later = verifier.verify("lease-a", fake.request);
    fake.answer("lease-a");
    await later;
    expect(fake.state.requests).toEqual(["lease-a", "lease-a"]);
  });

  test("many leases never have more Hub requests in flight than the bound", async () => {
    const verifier = new LeaseVerifier<string>({
      concurrency: 4,
      maxQueued: 100,
      maxWaitMs: 60_000,
    });
    const fake = hub();
    const leaseIds = Array.from({ length: 30 }, (_, index) => `lease-${index}`);

    const all = Promise.all(leaseIds.map((leaseId) => verifier.verify(leaseId, fake.request)));
    for (const leaseId of leaseIds) {
      await settle();
      fake.answer(leaseId);
    }

    expect(await all).toHaveLength(30);
    expect(fake.state.peak).toBe(4);
    expect(fake.state.requests).toHaveLength(30);
  });

  test("a lease beyond the waiting room is refused at once, without asking the Hub", async () => {
    const verifier = new LeaseVerifier<string>({ concurrency: 1, maxQueued: 1, maxWaitMs: 60_000 });
    const fake = hub();

    const first = verifier.verify("lease-1", fake.request);
    const queued = verifier.verify("lease-2", fake.request);
    await expect(verifier.verify("lease-3", fake.request)).rejects.toBeInstanceOf(
      LeaseVerificationUnavailableError,
    );
    fake.answer("lease-1");
    await first;
    await settle();
    fake.answer("lease-2");
    await queued;

    expect(fake.state.requests).toEqual(["lease-1", "lease-2"]);
  });

  test("a request that waited past every notification's deadline is dropped, not sent", async () => {
    let now = 0;
    const verifier = new LeaseVerifier<string>(
      { concurrency: 1, maxQueued: 10, maxWaitMs: 4_000 },
      () => now,
    );
    const fake = hub();

    const first = verifier.verify("lease-slow", fake.request);
    const stale = verifier.verify("lease-waiting", fake.request);
    now += 4_000;
    fake.answer("lease-slow");
    await first;

    await expect(stale).rejects.toBeInstanceOf(LeaseVerificationUnavailableError);
    expect(fake.state.requests).toEqual(["lease-slow"]);
    // The dropped request's slot is free again.
    const next = verifier.verify("lease-next", fake.request);
    await settle();
    fake.answer("lease-next");
    expect(await next).toBe("granted:lease-next");
  });

  test("a failed Hub request frees its slot", async () => {
    const verifier = new LeaseVerifier<string>({
      concurrency: 1,
      maxQueued: 10,
      maxWaitMs: 60_000,
    });

    await expect(
      verifier.verify("lease-a", () => Promise.reject(new Error("Hub timed out"))),
    ).rejects.toThrow("Hub timed out");
    expect(await verifier.verify("lease-b", async () => "granted:lease-b")).toBe("granted:lease-b");
  });
});
