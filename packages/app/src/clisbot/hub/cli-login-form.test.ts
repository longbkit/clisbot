import { describe, expect, it, vi } from "vitest";
import { openCliLoginForm } from "./cli-login-form";
import { HUB_HOST_DISCOVERY_WINDOW_MS, findNewlyEnrolledHost } from "./managed-host-discovery";

const daemon = (id: string, serverId: string | null) => ({
  id,
  connectionOffer: serverId === null ? null : { serverId },
});

describe("CLI login authorization", () => {
  it("captures a successful fresh baseline before approving and prevents duplicate decisions", async () => {
    let finishBaseline!: (value: ReturnType<typeof daemon>[]) => void;
    const baseline = [daemon("existing", "server-existing")];
    const decide = vi.fn(async () => ({ status: "approved" as const }));
    const form = openCliLoginForm({
      code: " CODE ",
      readDaemons: () =>
        new Promise((resolve) => {
          finishBaseline = resolve;
        }),
      decide,
      now: () => 100,
    });
    const pending = form.decide("approve", "org-one");
    await form.decide("approve", "org-one");
    expect(decide).not.toHaveBeenCalled();
    expect(form.getState().pending).toBe(true);
    finishBaseline(baseline);
    await pending;
    expect(decide).toHaveBeenCalledExactlyOnceWith({
      userCode: "CODE",
      decision: "approve",
      organizationId: "org-one",
    });
    expect(form.getState()).toMatchObject({
      baseline,
      decision: "approved",
      pending: false,
      discoveryDeadline: 100 + HUB_HOST_DISCOVERY_WINDOW_MS,
    });
  });

  it("keeps approval retryable when the baseline fails without approving against an empty catalog", async () => {
    const readDaemons = vi
      .fn()
      .mockRejectedValueOnce(new Error("Hosts unavailable"))
      .mockResolvedValueOnce([]);
    const decide = vi.fn(async () => ({ status: "approved" as const }));
    const form = openCliLoginForm({ code: "CODE", readDaemons, decide });
    await form.decide("approve", "org");
    expect(decide).not.toHaveBeenCalled();
    expect(form.getState()).toMatchObject({
      decision: null,
      pending: false,
      baseline: null,
      error: "Hosts unavailable",
    });
    await form.decide("approve", "org");
    expect(form.getState()).toMatchObject({
      decision: "approved",
      error: null,
    });
  });

  it("does not approve when an account or route unmounts while the baseline is pending", async () => {
    let finishBaseline!: (value: never[]) => void;
    const decide = vi.fn(async () => ({ status: "approved" as const }));
    const form = openCliLoginForm({
      code: "OLD",
      readDaemons: () =>
        new Promise((resolve) => {
          finishBaseline = resolve;
        }),
      decide,
    });
    const pending = form.decide("approve", "old-org");
    form.close();
    form.mount();
    finishBaseline([]);
    await pending;
    expect(decide).not.toHaveBeenCalled();
    expect(form.getState().decision).toBeNull();
  });

  it("can deny without a daemon catalog and cannot change a completed decision", async () => {
    const readDaemons = vi.fn();
    const decide = vi.fn(async () => ({ status: "denied" as const }));
    const form = openCliLoginForm({ code: "CODE", readDaemons, decide });
    await form.decide("deny", "org");
    await form.decide("approve", "org");
    expect(readDaemons).not.toHaveBeenCalled();
    expect(decide).toHaveBeenCalledTimes(1);
    expect(form.getState().decision).toBe("denied");
  });

  it("ends the discovery wait and retries with the original baseline without approving again", async () => {
    let now = 100;
    const baseline = [daemon("existing", "server-existing")];
    const decide = vi.fn(async () => ({ status: "approved" as const }));
    const form = openCliLoginForm({
      code: "CODE",
      readDaemons: async () => baseline,
      decide,
      now: () => now,
    });
    await form.decide("approve", "org");
    form.expireDiscovery();
    expect(form.getState().discoveryExpired).toBe(false);
    now += HUB_HOST_DISCOVERY_WINDOW_MS;
    form.expireDiscovery();
    expect(form.getState().discoveryExpired).toBe(true);
    form.retryDiscovery();
    expect(form.getState()).toMatchObject({
      discoveryExpired: false,
      baseline,
      discoveryDeadline: now + HUB_HOST_DISCOVERY_WINDOW_MS,
    });
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("lets the user correct an unavailable code with a fresh inspection", () => {
    const form = openCliLoginForm({
      code: "OLD",
      readDaemons: async () => [],
      decide: async () => ({ status: "approved" }),
    });
    form.editCode();
    expect(form.getState().submittedCode).toBe("");
    form.setCode(" NEW ");
    form.inspect();
    expect(form.getState().submittedCode).toBe("NEW");
  });
});

describe("CLI enrollment discovery", () => {
  it("checks all new offers when the first daemon has not synchronized yet", () => {
    expect(
      findNewlyEnrolledHost({
        baseline: [],
        daemons: [daemon("first", "one"), daemon("second", "two")],
        hosts: [{ serverId: "two" }],
      }),
    ).toEqual({ serverId: "two" });
  });

  it("finds a registering daemon after its offer arrives", () => {
    expect(
      findNewlyEnrolledHost({
        baseline: [daemon("old", null)],
        daemons: [daemon("old", "one")],
        hosts: [{ serverId: "one" }],
      }),
    ).toEqual({ serverId: "one" });
  });

  it("does not claim an unchanged existing host as the result of this approval", () => {
    expect(
      findNewlyEnrolledHost({
        baseline: [daemon("old", "one")],
        daemons: [daemon("old", "one")],
        hosts: [{ serverId: "one" }],
      }),
    ).toBeUndefined();
  });
});
