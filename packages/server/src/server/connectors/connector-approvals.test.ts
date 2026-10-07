import { describe, expect, it } from "vitest";
import type { AgentPermissionResponse } from "../agent/agent-sdk-types.js";
import { SendApprovals } from "./connector-approvals.js";

function deferred() {
  let resolve: (response: AgentPermissionResponse) => void = () => undefined;
  const promise = new Promise<AgentPermissionResponse>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("SendApprovals", () => {
  it("shares an open request between identical calls and gives its Allow to one of them", async () => {
    const approvals = new SendApprovals(() => 0);
    const answer = deferred();
    const raised: string[] = [];
    const raise = (id: string) => {
      raised.push(id);
      return answer.promise;
    };
    const first = approvals.decide("k", raise);
    const second = approvals.decide("k", raise);
    answer.resolve({ behavior: "allow" });
    expect(await Promise.all([first, second])).toEqual([{ kind: "allowed" }, { kind: "taken" }]);
    expect(raised).toHaveLength(1);

    // A used Allow is gone: the same send asks again, with a new request id.
    const again = approvals.decide("k", (id) => {
      raised.push(id);
      return Promise.resolve({ behavior: "deny", message: "no" });
    });
    expect(await again).toEqual({ kind: "declined", message: "no" });
    expect(new Set(raised).size).toBe(2);
  });

  it("keeps an Allow whose call was not sent, for one retry within ten minutes", async () => {
    let now = 0;
    const approvals = new SendApprovals(() => now);
    const raise = () => Promise.reject(new Error("should not ask"));
    approvals.keep("k");
    expect(await approvals.decide("k", raise)).toEqual({ kind: "allowed" });
    await expect(approvals.decide("k", raise)).rejects.toThrow("should not ask");

    approvals.keep("k");
    now = 11 * 60_000;
    await expect(approvals.decide("k", raise)).rejects.toThrow("should not ask");
  });
});
