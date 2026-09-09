// Offline tests for main-package dependency provisioning: the production
// closure walk over `npm-shrinkwrap.json`, and the fetch + verify + extract
// path (fake registry, in-test tarballs — no network, no npm). Idempotence is
// the tree's own completeness, not a marker file.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, it } from "vitest";
import { sha512Integrity } from "./integrity.js";
import type { MainPin } from "./pins.js";
import {
  isProvisioned,
  prodClosure,
  provisionMainDependencies,
  ProvisionError,
} from "./provision-main.js";

// --- in-test tarball builder (same minimal ustar shape as install-channel's) --

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width, "0");
}

function fileHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(octal(0o644, 8), 100, 8, "utf8");
  header.write("0", 108, 8, "utf8");
  header.write("0", 116, 8, "utf8");
  header.write(octal(size, 12), 124, 12, "utf8");
  header.write("0", 136, 12, "utf8");
  header.write(" ", 148, 8, "utf8");
  header.write("0", 156, 1, "utf8");
  header.write("ustar", 184, 6, "utf8");
  header.write("00", 200, 2, "utf8");
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += header[i] ?? 0;
  const digest = octal(sum, 6);
  header.write(digest, 148, 6, "utf8");
  header.write("\0", 154, 1, "utf8");
  header.write(" ", 155, 1, "utf8");
  return header;
}

function makeTarball(files: Record<string, string>): Uint8Array {
  const blocks: Buffer[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8");
    blocks.push(fileHeader(`package/${rel}`, data.length));
    blocks.push(data);
    const pad = 512 - (data.length % 512);
    if (pad < 512) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024));
  return new Uint8Array(gzipSync(Buffer.concat(blocks)));
}

/** Copy a buffer into a fresh exact-size ArrayBuffer (Response bodies must be
 * exact-size; a view over a larger buffer throws). */
function toBody(buffer: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(buffer);
  return copy;
}

/** Serve `tarballs` keyed by exact URL through a fetch-like seam. */
function fakeFetch(tarballs: Map<string, Uint8Array>): typeof fetch {
  return ((input: string | URL | Request) => {
    const url = String(input);
    const found = tarballs.get(url);
    if (found === undefined) {
      return Promise.resolve(new Response("no such tarball", { status: 404 }));
    }
    return Promise.resolve(new Response(toBody(found), { status: 200 }));
  }) as unknown as typeof fetch;
}

const MAIN_PIN: MainPin = {
  package: "openclaw",
  version: "2026.7.1-2",
  dist: { integrity: "sha512-" + "A".repeat(86) + "=" },
};

describe("prodClosure", () => {
  it("follows nested and top-level resolution, skips dev-only packages", () => {
    const shrinkwrap = {
      packages: {
        "": {
          dependencies: { a: "1.0.0", b: "2.0.0" },
          devDependencies: { jest: "99.0.0" },
        },
        "node_modules/a": { dependencies: { shared: "1.0.0" } },
        "node_modules/b": { dependencies: { shared: "2.0.0" } },
        "node_modules/b/node_modules/shared": {},
        "node_modules/shared": {},
        "node_modules/jest": {},
      },
    } as never;
    assert.deepEqual(prodClosure(shrinkwrap), [
      "node_modules/a",
      "node_modules/b",
      "node_modules/b/node_modules/shared",
      "node_modules/shared",
    ]);
  });

  it("falls back to the root node_modules when no nested key exists", () => {
    const shrinkwrap = {
      packages: {
        "": { dependencies: { ws: "8.0.0" } },
        "node_modules/ws": { optionalDependencies: { bufferutil: "^4.0.0" } },
        "node_modules/bufferutil": {},
      },
    } as never;
    assert.deepEqual(prodClosure(shrinkwrap), ["node_modules/bufferutil", "node_modules/ws"]);
  });

  it("ignores optionalDependencies of packages that are not installed", () => {
    const shrinkwrap = {
      packages: {
        "": { dependencies: { openai: "4.0.0" } },
        "node_modules/openai": {
          peerDependencies: { "@smithy/hash-node": ">=4.3.0" },
          optionalDependencies: { undici: "5.0.0" },
        },
        "node_modules/undici": {},
      },
    } as never;
    assert.deepEqual(prodClosure(shrinkwrap), ["node_modules/openai", "node_modules/undici"]);
  });

  it("refuses a shrinkwrap without a root package entry", () => {
    assert.throws(() => prodClosure({ packages: {} } as never), ProvisionError);
  });
});

describe("provisionMainDependencies", () => {
  let workDir: string;
  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "hub-provision-"));
  });
  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  const SHRINKWRAP = {
    name: "openclaw",
    version: "2026.7.1-2",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "openclaw",
        version: "2026.7.1-2",
        dependencies: { typebox: "1.3.3" },
      },
      "node_modules/typebox": {
        version: "1.3.3",
        resolved: "https://registry.example/deps/typebox-1.3.3.tgz",
        integrity: "sha512-placeholder",
      },
    },
  };

  function seedMainDir(root: string): {
    mainDir: string;
    typeboxTarball: Uint8Array;
  } {
    const mainDir = join(root, "main");
    mkdirSync(mainDir, { recursive: true });
    const typeboxTarball = makeTarball({
      "package.json": '{"name":"typebox","version":"1.3.3"}',
      "index.js": "module.exports = {};",
    });
    writeFileSync(
      join(mainDir, "npm-shrinkwrap.json"),
      JSON.stringify({
        ...SHRINKWRAP,
        packages: {
          ...SHRINKWRAP.packages,
          "node_modules/typebox": {
            ...SHRINKWRAP.packages["node_modules/typebox"],
            integrity: sha512Integrity(typeboxTarball),
          },
        },
      }),
    );
    return { mainDir, typeboxTarball };
  }

  it("fetches, verifies, and extracts the production closure", async () => {
    const root = join(workDir, "p1");
    const { mainDir, typeboxTarball } = seedMainDir(root);
    const calls: string[] = [];
    const fetchImpl = ((input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url === "https://registry.example/deps/typebox-1.3.3.tgz") {
        return Promise.resolve(new Response(toBody(typeboxTarball), { status: 200 }));
      }
      return Promise.resolve(new Response("no such tarball", { status: 404 }));
    }) as unknown as typeof fetch;
    const result = await provisionMainDependencies(mainDir, MAIN_PIN, fetchImpl, "telegram");
    assert.equal(result.provisioned, true);
    assert.equal(result.entries, 1);
    assert.deepEqual(calls, ["https://registry.example/deps/typebox-1.3.3.tgz"]);
    assert.ok(existsSync(join(mainDir, "node_modules", "typebox", "index.js")));
    assert.equal(isProvisioned(mainDir, MAIN_PIN), true);
    // No custom marker: idempotence is the tree, not a lock file.
    assert.ok(!existsSync(join(mainDir, "node_modules", "provision.lock")));
  });

  it("is a no-op when the shrinkwrap-backed tree is complete", async () => {
    const root = join(workDir, "p2");
    const { mainDir, typeboxTarball } = seedMainDir(root);
    const tarballs = new Map<string, Uint8Array>([
      ["https://registry.example/deps/typebox-1.3.3.tgz", typeboxTarball],
    ]);
    const fetchImpl = fakeFetch(tarballs);
    await provisionMainDependencies(mainDir, MAIN_PIN, fetchImpl, "telegram");
    let calls = 0;
    const counting = ((input: string | URL | Request) => {
      calls += 1;
      return fetchImpl(input);
    }) as typeof fetch;
    const second = await provisionMainDependencies(mainDir, MAIN_PIN, counting, "telegram");
    assert.equal(second.provisioned, false);
    assert.equal(calls, 0);
  });

  it("re-provisions when the tree is incomplete", async () => {
    const root = join(workDir, "p5");
    const { mainDir, typeboxTarball } = seedMainDir(root);
    const tarballs = new Map<string, Uint8Array>([
      ["https://registry.example/deps/typebox-1.3.3.tgz", typeboxTarball],
    ]);
    await provisionMainDependencies(mainDir, MAIN_PIN, fakeFetch(tarballs), "telegram");
    // A package deleted out from under the install is detected by the missing
    // package.json, and rebuilt on the next call.
    rmSync(join(mainDir, "node_modules", "typebox"), { recursive: true, force: true });
    assert.equal(isProvisioned(mainDir, MAIN_PIN), false);
    await provisionMainDependencies(mainDir, MAIN_PIN, fakeFetch(tarballs), "telegram");
    assert.ok(existsSync(join(mainDir, "node_modules", "typebox", "package.json")));
    assert.equal(isProvisioned(mainDir, MAIN_PIN), true);
  });

  it("refuses a dependency whose bytes do not match the lockfile integrity", async () => {
    const root = join(workDir, "p3");
    const { mainDir } = seedMainDir(root);
    const tampered = makeTarball({ "package.json": '{"evil":true}' });
    const tarballs = new Map<string, Uint8Array>([
      ["https://registry.example/deps/typebox-1.3.3.tgz", tampered],
    ]);
    await assert.rejects(
      () => provisionMainDependencies(mainDir, MAIN_PIN, fakeFetch(tarballs), "slack"),
      (error: unknown) =>
        error instanceof ProvisionError && /integrity mismatch/u.test(error.message),
    );
    assert.ok(!existsSync(join(mainDir, "node_modules", "typebox")));
  });

  it("reports a fetch 404 as a ProvisionError naming the dependency", async () => {
    const root = join(workDir, "p4");
    const { mainDir } = seedMainDir(root);
    await assert.rejects(
      () => provisionMainDependencies(mainDir, MAIN_PIN, fakeFetch(new Map()), "slack"),
      (error: unknown) =>
        error instanceof ProvisionError &&
        /dependency fetch failed for node_modules\/typebox/u.test(error.message),
    );
  });
});
