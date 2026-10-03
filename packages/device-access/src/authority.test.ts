import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { DeviceAuthority } from "./authority.js";
import { FileDeviceAuthorityStore } from "./file-store.js";
import {
  createDeviceKey,
  digest,
  signDeviceProof,
  type DeviceKey,
  type ProofContext,
} from "./proof.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "clisbot-device-access-"));
  homes.push(home);
  const path = join(home, "device-access.json");
  let now = 100_000;
  const create = () =>
    new DeviceAuthority(new FileDeviceAuthorityStore(path, "daemon-1"), () => now);
  const key = createDeviceKey(randomBytes(32));
  const proof = (credentialId: string, context: ProofContext, signingKey: DeviceKey = key) =>
    signDeviceProof({
      key: signingKey,
      proof: {
        backendId: "daemon-1",
        credentialId,
        timestamp: now,
        nonce: randomBytes(24).toString("base64url"),
      },
      context,
    });
  const authority = create();
  const pair = async () => {
    const invitation = await authority.createInvitation({ label: "Long’s phone" });
    const context: ProofContext = { purpose: "pair", binding: digest(invitation.token) };
    const device = await authority.redeem({
      token: invitation.token,
      publicKey: key.publicKey,
      proof: proof("pair", context),
    });
    return { invitation, device, context };
  };
  return {
    authority,
    create,
    key,
    path,
    proof,
    pair,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("backend-owned device access", () => {
  it("registers only login authority after account authentication and preserves independent owner grants", async () => {
    const f = await fixture();
    const login = await f.authority.registerLoginDevice({
      publicKey: f.key.publicKey,
      label: "Phone",
    });
    expect(login.grant).toBe("login");
    const again = await f
      .create()
      .registerLoginDevice({ publicKey: f.key.publicKey, label: "Other label" });
    expect(again.id).toBe(login.id);
    expect(again.label).toBe("Phone");
    const { device } = await f.pair();
    expect(device.id).toBe(login.id);
    expect(device.grant).toBe("owner");
    expect((await f.authority.registerLoginDevice({ publicKey: f.key.publicKey })).grant).toBe(
      "owner",
    );
    await f.authority.revoke(device.id);
    const next = await f.authority.registerLoginDevice({ publicKey: f.key.publicKey });
    expect(next.id).not.toBe(device.id);
    expect(next.grant).toBe("login");
  });

  it("keeps labels cosmetic and rejects terminal controls and bidirectional spoofing", async () => {
    const f = await fixture();
    const { device } = await f.pair();
    await f.authority.rename(device.id, "Phone 📱 <Owner>");
    const renamed = (await f.authority.list())[0];
    expect(renamed.label).toBe("Phone 📱 <Owner>");
    expect({ ...renamed, label: device.label }).toEqual(device);
    for (const label of [
      "bad\u001b[31m",
      "bad\u009b31m",
      "safe\u202e.exe",
      "safe\u2066owner\u2069",
      "x".repeat(81),
    ]) {
      expect(() => f.authority.rename(device.id, label)).toThrow("printable");
      expect(() => f.authority.createInvitation({ label })).toThrow("printable");
    }
  });

  it("stores only invitation verifiers, persists labels and recovers a lost response for the same key", async () => {
    const f = await fixture();
    const { invitation, device, context } = await f.pair();
    const retried = await f.create().redeem({
      token: invitation.token,
      publicKey: f.key.publicKey,
      proof: f.proof("pair", context),
    });
    expect(retried.id).toBe(device.id);
    expect(retried.label).toBe("Long’s phone");
    const persisted = await readFile(f.path, "utf8");
    expect(persisted).not.toContain(invitation.token);
    expect(persisted).not.toContain(f.key.privateKey);
    if (process.platform !== "win32") expect((await stat(f.path)).mode & 0o777).toBe(0o600);
  });

  it("atomically binds one invitation when independent stores race to redeem", async () => {
    const f = await fixture();
    const invitation = await f.authority.createInvitation();
    const context: ProofContext = { purpose: "pair", binding: digest(invitation.token) };
    const keys = [f.key, createDeviceKey(randomBytes(32))];
    const results = await Promise.allSettled(
      keys.map((key) =>
        f.create().redeem({
          token: invitation.token,
          publicKey: key.publicKey,
          proof: f.proof("pair", context, key),
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await f.authority.list()).toHaveLength(1);
  });

  it("expires invitations and rejects a different key, a revoked retry and forged possession", async () => {
    const f = await fixture();
    const { invitation, device, context } = await f.pair();
    const other = createDeviceKey(randomBytes(32));
    await expect(
      f.authority.redeem({
        token: invitation.token,
        publicKey: other.publicKey,
        proof: f.proof("pair", context, other),
      }),
    ).rejects.toThrow("already used");
    await expect(
      f.authority.redeem({
        token: invitation.token,
        publicKey: other.publicKey,
        proof: f.proof("pair", context),
      }),
    ).rejects.toThrow("Invalid device proof");
    await f.authority.revoke(device.id);
    await expect(
      f.authority.redeem({
        token: invitation.token,
        publicKey: f.key.publicKey,
        proof: f.proof("pair", context),
      }),
    ).rejects.toThrow("already used");
    f.advance(300_000);
    await expect(
      f.authority.redeem({
        token: invitation.token,
        publicKey: f.key.publicKey,
        proof: f.proof("pair", context),
      }),
    ).rejects.toThrow("expired");
  });

  it("binds proofs to backend, credential, purpose, request and time; survives restart without replay", async () => {
    const f = await fixture();
    const { device } = await f.pair();
    const context: ProofContext = { purpose: "http", binding: "/api/management/devices" };
    const proof = f.proof(device.id, context);
    await expect(
      f.authority.authenticate({ ...proof, backendId: "hub-1" }, context),
    ).rejects.toThrow();
    await expect(
      f.authority.authenticate({ ...proof, credentialId: "other" }, context),
    ).rejects.toThrow();
    await expect(
      f.authority.authenticate(proof, { ...context, purpose: "hello" }),
    ).rejects.toThrow();
    await expect(
      f.authority.authenticate(proof, { ...context, binding: "/other" }),
    ).rejects.toThrow();
    await expect(f.authority.authenticate(proof, context)).resolves.toMatchObject({
      id: device.id,
    });
    await expect(f.create().authenticate(proof, context)).rejects.toThrow("already used");
    f.advance(60_001);
    await expect(f.create().authenticate(proof, context)).rejects.toThrow("Invalid device proof");
  });

  it("revokes a credential durably and persists mandatory login separately from device trust", async () => {
    const f = await fixture();
    const { device } = await f.pair();
    await f.authority.setLoginRequired(true);
    await f.authority.rename(device.id, "Pixel");
    expect(await f.create().info()).toEqual({ backendId: "daemon-1", loginRequired: true });
    expect((await f.authority.list())[0]?.label).toBe("Pixel");
    await f.authority.revoke(device.id);
    const context: ProofContext = { purpose: "hello", binding: "client-1" };
    await expect(f.create().authenticate(f.proof(device.id, context), context)).rejects.toThrow(
      "not authorized",
    );
  });

  it("fails closed on malformed persistence and rejects invalid TTL and labels", async () => {
    const f = await fixture();
    expect(() => f.authority.createInvitation({ ttlMs: Infinity })).toThrow("TTL");
    expect(() => f.authority.createInvitation({ label: "\n" })).toThrow("label");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(f.path, "{broken");
    await expect(f.authority.info()).rejects.toThrow();
    await writeFile(
      f.path,
      JSON.stringify({
        version: 1,
        backendId: "daemon-1",
        devices: [],
        invitations: [],
        replays: [],
      }),
    );
    await expect(f.authority.info()).rejects.toThrow("Invalid device authority state");
  });

  it("rejects reusing a pairing proof and reuses device identity without widening a login grant", async () => {
    const f = await fixture();
    const invite = await f.authority.createInvitation({ grant: "login", label: "Phone" });
    const context: ProofContext = { purpose: "pair", binding: digest(invite.token) };
    const proof = f.proof("pair", context);
    const device = await f.authority.redeem({
      token: invite.token,
      publicKey: f.key.publicKey,
      proof,
    });
    await expect(
      f.create().redeem({ token: invite.token, publicKey: f.key.publicKey, proof }),
    ).rejects.toThrow("already used");
    const next = await f.authority.createInvitation({ grant: "login", label: "Renamed phone" });
    const retried = await f.authority.redeem({
      token: next.token,
      publicKey: f.key.publicKey,
      proof: f.proof("pair", { purpose: "pair", binding: digest(next.token) }),
    });
    expect(retried).toMatchObject({ id: device.id, grant: "login", label: "Renamed phone" });
    expect(await f.authority.list()).toHaveLength(1);
    await f.authority.setLoginRequired(false);
    expect((await f.authority.list())[0]?.grant).toBe("login");
  });
});
