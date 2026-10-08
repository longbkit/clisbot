import { describe, expect, it } from "vitest";
import { diagnoseUnavailableHub, isStoppedHostHub } from "./unavailable-hub";

const oldHost = {
  serverId: "srv_old",
  label: "My Mac",
  management: { hubOrigin: "hub://hub-1" },
};
const newHost = { serverId: "srv_new", label: "My Mac" };
const base = {
  hubId: "hub-1",
  origin: "http://127.0.0.1:6880",
  hosts: [oldHost, newHost],
  detected: [],
  localServerId: "srv_new",
};

describe("diagnoseUnavailableHub", () => {
  it("offers a new Hub on a connected Host when the Host it ran on is gone", () => {
    expect(diagnoseUnavailableHub({ ...base, connectedIds: ["srv_new"] })).toEqual({
      kind: "hostGone",
      ranOn: { serverId: "srv_old", label: "My Mac" },
      startOn: { serverId: "srv_new", label: "My Mac" },
    });
  });

  it("starts the same Hub again when its connected Host still belongs to it", () => {
    expect(
      diagnoseUnavailableHub({
        ...base,
        connectedIds: ["srv_old"],
        detected: [{ serverId: "srv_old", connection: { hubId: "hub-1" } }],
      }),
    ).toEqual({ kind: "stopped", host: { serverId: "srv_old", label: "My Mac" } });
  });

  it("starts it again when its Host still points at it but the Hub is down", () => {
    // The Host reports its Hub's address; the id only arrives once that Hub answers.
    expect(
      diagnoseUnavailableHub({
        ...base,
        connectedIds: ["srv_old"],
        detected: [{ serverId: "srv_old", stopped: true }],
      }),
    ).toEqual({ kind: "stopped", host: { serverId: "srv_old", label: "My Mac" } });
  });

  it("points to the Hub that replaced it on the same Host", () => {
    const other = { serverId: "srv_old", connection: { hubId: "hub-2" } };
    expect(
      diagnoseUnavailableHub({ ...base, connectedIds: ["srv_old"], detected: [other] }),
    ).toEqual({ kind: "replaced", host: { serverId: "srv_old", label: "My Mac" }, other });
  });

  it("has nowhere to start when no Host is connected", () => {
    expect(diagnoseUnavailableHub({ ...base, connectedIds: [] })).toEqual({
      kind: "hostGone",
      ranOn: { serverId: "srv_old", label: "My Mac" },
      startOn: null,
    });
  });

  it("treats a Hub with its own address and no known Host as unreachable", () => {
    expect(
      diagnoseUnavailableHub({
        ...base,
        origin: "https://hub.example.com",
        hosts: [newHost],
        connectedIds: ["srv_new"],
      }),
    ).toEqual({ kind: "unreachable" });
  });
});

describe("isStoppedHostHub", () => {
  const local = "http://127.0.0.1:6870";
  it("is stopped when the Host's own Hub refused its last attempt", () => {
    expect(
      isStoppedHostHub({ state: "reconnecting", hubOrigin: local, lastError: "ECONNREFUSED" }),
    ).toBe(true);
    expect(isStoppedHostHub({ state: "not_connected", hubOrigin: local, lastError: null })).toBe(
      true,
    );
  });

  it("is not stopped while starting, after a revoke, or for a Hub elsewhere", () => {
    expect(isStoppedHostHub({ state: "connecting", hubOrigin: local, lastError: null })).toBe(
      false,
    );
    expect(isStoppedHostHub({ state: "revoked", hubOrigin: local, lastError: "revoked" })).toBe(
      false,
    );
    expect(
      isStoppedHostHub({
        state: "reconnecting",
        hubOrigin: "https://hub.example.com",
        lastError: "timeout",
      }),
    ).toBe(false);
  });
});
