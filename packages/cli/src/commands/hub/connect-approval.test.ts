import assert from "node:assert/strict";
import { describe, it, vi, expect } from "vitest";
import { runHubConnect } from "./connect.js";
import type { HubStatus, HubDaemonClient } from "./daemon-client.js";
import { DEFAULT_HUB_CONNECTION_PERMISSIONS } from "./permissions.js";
import { CliLoginFlow } from "./login-flow.js";

function setup() {
  const identity = { serverId: "host-one", daemonPublicKey: "public-key", hostname: "laptop" };
  let status: HubStatus = {
    state: "not_connected",
    daemonId: null,
    hubOrigin: null,
    permissions: [],
    connectedAt: null,
    lastError: null,
    enrollmentIdentity: identity,
  };
  const daemon: HubDaemonClient = {
    getLastServerInfoMessage: () => ({ features: { hubEnrollmentIdentity: true } }),
    getHubStatus: async () => ({ status }),
    connectHub: vi.fn(async (origin, _token, permissions = []) => {
      status = {
        ...status,
        hubOrigin: origin,
        state: "connected",
        daemonId: "daemon-id",
        permissions: [...permissions],
      };
      return { status };
    }),
    close: vi.fn(async () => {}),
    disconnectHub: vi.fn(async () => ({ status })),
    updateHubPermissions: async () => {
      throw new Error("unused");
    },
    getProvidersSnapshot: async () => ({ entries: [] }),
  };
  const credentials = {
    active: () => null,
    get: () => {
      throw new Error("must not read stored CLI credentials");
    },
    save: () => {
      throw new Error("must not store CLI credentials");
    },
    logoutActive: () => null,
  };
  const enrollment = { authorizeEnrollment: vi.fn(async () => "single-use-token") };
  const hub = {
    issueEnrollmentToken: vi.fn(async () => "api-key-enrollment-token"),
    describeCredential: async () => {
      throw new Error("must not describe CLI access");
    },
  };
  return {
    daemon,
    identity,
    setStatus: (change: Partial<HubStatus>) => {
      status = { ...status, ...change };
    },
    deps: {
      env: {},
      credentials,
      hub,
      enrollment,
      daemon: { connect: async () => daemon },
      reporter: { progress: () => {} },
    },
  };
}

describe("browser-approved hub connect", () => {
  it("enrolls directly in JSON/non-TTY mode, ignores stored CLI access, and repeats without another approval", async () => {
    const test = setup();
    const result = await runHubConnect("https://hub.test", { json: true }, test.deps);
    assert.equal(result.data[0]?.state, "connected");
    expect(test.deps.enrollment.authorizeEnrollment).toHaveBeenCalledExactlyOnceWith(
      "https://hub.test",
      { ...test.identity, permissions: DEFAULT_HUB_CONNECTION_PERMISSIONS },
    );
    expect(test.daemon.connectHub).toHaveBeenCalledExactlyOnceWith(
      "https://hub.test",
      "single-use-token",
      DEFAULT_HUB_CONNECTION_PERMISSIONS,
    );
    await runHubConnect("https://hub.test", {}, test.deps);
    expect(test.deps.enrollment.authorizeEnrollment).toHaveBeenCalledTimes(1);
    expect(test.deps.hub.issueEnrollmentToken).not.toHaveBeenCalled();
    expect(test.daemon.close).toHaveBeenCalledTimes(2);
  });
  it("refuses another Hub and permission changes before asking for authority", async () => {
    const test = setup();
    test.setStatus({ hubOrigin: "https://other.test", state: "connected" });
    await assert.rejects(
      runHubConnect("https://hub.test", {}, test.deps),
      /Disconnect it explicitly/,
    );
    test.setStatus({ hubOrigin: "https://hub.test", permissions: ["hub.execute"] });
    await assert.rejects(
      runHubConnect("https://hub.test", { permissions: [] }, test.deps),
      /different permissions/,
    );
    expect(test.deps.enrollment.authorizeEnrollment).not.toHaveBeenCalled();
  });
  it("uses the enrollment response when Managed Access closes the ticketless CLI session", async () => {
    const test = setup();
    test.daemon.connectHub = vi.fn(async (origin, _token, permissions = []) => {
      test.daemon.getHubStatus = async () => {
        throw new Error("Managed access is now required");
      };
      return {
        status: {
          state: "connecting",
          daemonId: "daemon-id",
          hubOrigin: origin,
          permissions: [...permissions],
          connectedAt: null,
          lastError: null,
        },
      };
    });
    const result = await runHubConnect("https://hub.test", { json: true }, test.deps);
    assert.equal(result.data[0]?.state, "connecting");
    assert.equal(result.data[0]?.daemonId, "daemon-id");
    expect(test.daemon.close).toHaveBeenCalledTimes(1);
    expect(test.deps.hub.issueEnrollmentToken).not.toHaveBeenCalled();
  });
  it("supports an explicit enrollment API key without browser approval", async () => {
    const test = setup();
    await runHubConnect("https://hub.test", { apiKey: "scoped-key", permissions: [] }, test.deps);
    expect(test.deps.hub.issueEnrollmentToken).toHaveBeenCalledWith(
      "https://hub.test",
      "scoped-key",
    );
    expect(test.deps.enrollment.authorizeEnrollment).not.toHaveBeenCalled();
  });
  it("refuses older daemons and denied approval without enrolling", async () => {
    const test = setup();
    test.setStatus({ enrollmentIdentity: undefined });
    await assert.rejects(runHubConnect("https://hub.test", {}, test.deps), /Update the Host/);
    test.setStatus({ enrollmentIdentity: test.identity });
    test.deps.enrollment.authorizeEnrollment.mockRejectedValueOnce(new Error("denied"));
    await assert.rejects(runHubConnect("https://hub.test", {}, test.deps), /denied/);
    expect(test.daemon.connectHub).not.toHaveBeenCalled();
  });
  it("does not claim success if the relationship remains pending", async () => {
    const test = setup();
    let now = 0;
    test.setStatus({ hubOrigin: "https://hub.test", state: "connecting" });
    await assert.rejects(
      runHubConnect(
        "https://hub.test",
        {},
        {
          ...test.deps,
          now: () => now,
          wait: async (delay) => {
            now += delay;
          },
        },
      ),
      /Check clisbot hub status/,
    );
    expect(test.deps.enrollment.authorizeEnrollment).not.toHaveBeenCalled();
  });
  it("enrollment polling requires its purpose and rejects a broad credential response", async () => {
    let now = 0;
    const poll = vi.fn(async () => ({
      status: "enrollment_authorized" as const,
      interval: 5,
      token: "host-token",
      organizationId: "org",
    }));
    const flow = new CliLoginFlow({
      hub: {
        startCliAuthorization: async () => ({
          deviceCode: "device",
          userCode: "CODE",
          verificationUri: "https://hub.test/cli-login",
          verificationUriComplete: "https://hub.test/cli-login?code=CODE",
          expiresAt: new Date(60_000).toISOString(),
          interval: 5,
        }),
        pollCliAuthorization: poll,
      },
      waiter: {
        now: () => now,
        wait: async (delay) => {
          now += delay;
        },
      },
      browser: { open: async () => {} },
      openBrowser: false,
      instructions: () => {},
    });
    assert.equal(
      await flow.authorizeEnrollment("https://hub.test", { ...setup().identity, permissions: [] }),
      "host-token",
    );
    expect(poll).toHaveBeenCalledWith("https://hub.test", "device", 55_000, "host_enrollment");
    await assert.rejects(flow.authorize("https://hub.test"), /wrong authorization purpose/);
  });
});
