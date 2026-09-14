import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startStaticAppServer } from "../e2e/support/static-app-server";

async function main() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "paseo-static-app-smoke-"));
  let server: Awaited<ReturnType<typeof startStaticAppServer>> | undefined;
  try {
    const root = path.join(temporary, "export");
    await mkdir(root);
    await writeFile(path.join(root, "index.html"), "<!doctype html><title>Isolated app</title>");
    await writeFile(path.join(root, "app.js"), "globalThis.smoke = true;");
    await writeFile(path.join(temporary, "outside.txt"), "outside export");
    await symlink(path.join(temporary, "outside.txt"), path.join(root, "escape.txt"));
    server = await startStaticAppServer(root, 0);
    const origin = `http://127.0.0.1:${server.port}`;
    assert.match(await (await fetch(`${origin}/`)).text(), /Isolated app/);
    assert.match(
      await (
        await fetch(`${origin}/workspace/example`, { headers: { accept: "text/html" } })
      ).text(),
      /Isolated app/,
    );
    assert.match((await fetch(`${origin}/app.js`)).headers.get("content-type") ?? "", /javascript/);
    assert.equal((await fetch(`${origin}/missing.js`)).status, 404);
    assert.equal((await fetch(`${origin}/escape.txt`)).status, 404);
    assert.equal(await (await fetch(`${origin}/app.js`, { method: "HEAD" })).text(), "");
    assert.equal((await fetch(origin, { method: "POST" })).status, 405);
    process.stdout.write(
      JSON.stringify({ checks: 7, status: "passed", isolatedPort: server.port }) + "\n",
    );
  } finally {
    await server?.close();
    await rm(temporary, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
