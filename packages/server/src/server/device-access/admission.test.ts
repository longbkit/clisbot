import { afterEach, expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceAuthority } from "@clisbot/device-access/authority";
import { FileDeviceAuthorityStore } from "@clisbot/device-access/file-store";
import {
  createDeviceKey,
  digest,
  helloBinding,
  signDeviceProof,
} from "@clisbot/device-access/proof";
import type { WSHelloMessage } from "@clisbot/protocol/messages";
import { resolveSessionAdmission } from "../session-admission-auth.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((h) => rm(h, { recursive: true, force: true })));
});

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "clisbot-admission-"));
  homes.push(home);
  const authority = new DeviceAuthority(
    new FileDeviceAuthorityStore(join(home, "access.json"), "daemon-1"),
  );
  const key = createDeviceKey(randomBytes(32));
  const hello: WSHelloMessage = {
    type: "hello",
    clientId: "phone",
    clientType: "mobile",
    protocolVersion: 1,
  };
  const sign = (id: string, purpose: "pair" | "hello", binding: string) =>
    signDeviceProof({
      key,
      proof: {
        backendId: "daemon-1",
        credentialId: id,
        timestamp: Date.now(),
        nonce: randomBytes(24).toString("base64url"),
      },
      context: { purpose, binding },
    });
  const resolve = (
    message: WSHelloMessage,
    transport: "direct" | "relay" = "direct",
    allowManagedTicket = false,
  ) =>
    resolveSessionAdmission({
      credential: message.auth,
      hello: message,
      deviceAuthority: authority,
      passwordHash: undefined,
      localCredential: "operator-secret",
      transport,
      allowManagedTicket,
      encrypted: true,
    });
  return { authority, key, hello, sign, resolve };
}

test("protected admission rejects anonymous/password traffic on direct and relay, retaining OS operator access", async () => {
  const f = await fixture();
  for (const transport of ["direct", "relay"] as const) {
    expect(await f.resolve(f.hello, transport)).toEqual({ rejection: "password_required" });
    expect(
      await f.resolve({ ...f.hello, auth: { kind: "password", password: "anything" } }, transport),
    ).toEqual({ rejection: "incorrect_password" });
  }
  expect(
    await f.resolve({ ...f.hello, auth: { kind: "localCredential", token: "operator-secret" } }),
  ).toMatchObject({ admission: { principalId: "owner" } });
});

test("pairing admits one device, rejects replay and reuses the credential only with a fresh proof", async () => {
  const f = await fixture();
  const invitation = await f.authority.createInvitation();
  const proof = f.sign("pair", "pair", digest(invitation.token));
  const hello: WSHelloMessage = {
    ...f.hello,
    auth: { kind: "pairing", token: invitation.token, publicKey: f.key.publicKey, proof },
  };
  const first = await f.resolve(hello);
  expect(first).toMatchObject({ admission: { deviceCredential: { backendId: "daemon-1" } } });
  expect(await f.resolve(hello, "relay")).toEqual({ rejection: "incorrect_password" });
  if (!("admission" in first)) throw new Error("Expected admission");
  const id = first.admission.deviceCredential!.credentialId;
  expect(
    await f.resolve(
      { ...f.hello, auth: { kind: "device", proof: f.sign(id, "hello", helloBinding(f.hello)) } },
      "relay",
    ),
  ).toMatchObject({ admission: { principalId: `device:${id}` } });
  await f.authority.revoke(id);
  expect(
    await f.resolve({
      ...f.hello,
      auth: { kind: "device", proof: f.sign(id, "hello", helloBinding(f.hello)) },
    }),
  ).toEqual({ rejection: "incorrect_password" });
});

test("external tickets pass only to the managed resolver, with no interim permissions or owner identity", async () => {
  const f = await fixture();
  expect(await f.resolve({ ...f.hello, accessTicket: "unverified" }, "direct", true)).toEqual({
    admission: { principalId: "pending-ticket", permissions: [] },
  });
  expect(await f.resolve({ ...f.hello, accessTicket: "unverified" })).toEqual({
    rejection: "password_required",
  });
});

test("feature disabled retains legacy direct and relay admission", async () => {
  for (const transport of ["direct", "relay"] as const) {
    expect(
      await resolveSessionAdmission({
        credential: undefined,
        passwordHash: undefined,
        localCredential: null,
        transport,
      }),
    ).toMatchObject({ admission: { principalId: "owner" } });
  }
});
