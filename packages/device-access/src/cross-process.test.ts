import { expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DeviceAuthority } from "./authority.js";
import { FileDeviceAuthorityStore } from "./file-store.js";
import { createDeviceKey, digest, signDeviceProof } from "./proof.js";
import { loadServiceKey } from "./service-key.js";

const childScript = `
import { DeviceAuthority } from '@clisbot/device-access/authority';
import { FileDeviceAuthorityStore } from '@clisbot/device-access/file-store';
let text=''; for await(const chunk of process.stdin) text+=chunk;
const input=JSON.parse(text);
try { const device=await new DeviceAuthority(new FileDeviceAuthorityStore(input.file,'race-backend')).redeem(input.redemption); process.stdout.write(JSON.stringify({ok:true,id:device.id})); }
catch { process.stdout.write(JSON.stringify({ok:false})); }
`;
function redeemInChild(input: unknown): Promise<{ ok: boolean; id?: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", childScript], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    const timer = setTimeout(() => child.kill(), 10_000);
    let result = "";
    child.stdout.on("data", (data) => {
      result += data;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error("Pairing child failed"));
        return;
      }
      resolve(JSON.parse(result));
    });
    child.stdin.end(JSON.stringify(input));
  });
}

test("two real processes cannot consume one invitation for different devices", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "clisbot-device-race-"));
  const file = path.join(home, "devices.json");
  try {
    const authority = new DeviceAuthority(new FileDeviceAuthorityStore(file, "race-backend"));
    const invite = await authority.createInvitation();
    const keys = [createDeviceKey(randomBytes(32)), createDeviceKey(randomBytes(32))];
    const results = await Promise.all(
      keys.map((key) =>
        redeemInChild({
          file,
          redemption: {
            token: invite.token,
            publicKey: key.publicKey,
            proof: signDeviceProof({
              key,
              proof: {
                backendId: "race-backend",
                credentialId: "pair",
                timestamp: Date.now(),
                nonce: randomBytes(24).toString("base64url"),
              },
              context: { purpose: "pair", binding: digest(invite.token) },
            }),
          },
        }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await authority.list()).toHaveLength(1);
    expect(await readFile(file, "utf8")).not.toContain(invite.token);
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 15_000);

test("Hub transport identity persists and corruption never silently rotates its key", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "clisbot-service-key-"));
  const file = path.join(home, "key.json");
  try {
    const first = await loadServiceKey(file);
    expect((await loadServiceKey(file)).publicKey).toBe(first.publicKey);
    const stored = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...stored, publicKey: "changed" }));
    await expect(loadServiceKey(file)).rejects.toThrow("mismatch");
    expect(JSON.parse(await readFile(file, "utf8")).publicKey).toBe("changed");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
