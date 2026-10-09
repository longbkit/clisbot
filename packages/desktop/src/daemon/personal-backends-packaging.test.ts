import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { createPackage, uncache } = require("@electron/asar") as {
  createPackage(source: string, destination: string): Promise<void>;
  uncache(file: string): void;
};
const { verifyPersonalBackends } = require("../../scripts/verify-personal-backends.js") as {
  verifyPersonalBackends(directory: string): void;
};
const fixtures: string[] = [];
afterEach(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
  fixtures.length = 0;
});

test("checks actual packaged Hub, gateway, device proof and web assets before distributing clients", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "clisbot-personal-package-"));
  fixtures.push(root);
  const source = path.join(root, "source");
  const resources = path.join(root, "resources");
  const files = [
    "node_modules/@clisbot/hub/bin/clisbot-hub.js",
    "node_modules/@clisbot/hub/dist/index.js",
    "node_modules/@clisbot/hub/dist/runtime-files.js",
    "node_modules/@clisbot/hub/.output/server/start-server.js",
    "node_modules/@clisbot/hub/drizzle/meta/_journal.json",
    "node_modules/@clisbot/cli/dist/index.js",
    "node_modules/@clisbot/cli/dist/commands/serve/gateway-entry.js",
    "node_modules/@clisbot/cli/dist/commands/serve/service-supervisor-entry.js",
    "node_modules/@clisbot/device-access/dist/authority.js",
    "node_modules/@clisbot/device-access/dist/proof.js",
    "node_modules/@clisbot/channels-slack/dist/index.js",
    "node_modules/@clisbot/channels-slack/dist/plugin.js",
  ];
  for (const file of files) {
    const target = path.join(source, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "export {};\n");
  }
  writeFileSync(
    path.join(source, "node_modules/@clisbot/hub/channel-pins.json"),
    JSON.stringify({
      channels: {
        slack: {
          loadMode: "in-repo",
          inRepoPackage: "@clisbot/channels-slack",
          entry: "./dist/index.js",
          plugin: { specifier: "./dist/plugin.js" },
        },
      },
    }),
  );
  mkdirSync(path.join(resources, "app-dist"), { recursive: true });
  await createPackage(source, path.join(resources, "app.asar"));
  expect(() => verifyPersonalBackends(resources)).toThrow("app-dist/index.html");
  writeFileSync(
    path.join(resources, "app-dist", "index.html"),
    "<!doctype html><title>Clisbot</title>",
  );
  expect(() => verifyPersonalBackends(resources)).toThrow("node-entrypoint-runner.js");
  const runner = path.join(
    resources,
    "app.asar.unpacked",
    "dist",
    "daemon",
    "node-entrypoint-runner.js",
  );
  mkdirSync(path.dirname(runner), { recursive: true });
  writeFileSync(runner, "exports.main = async () => {};\n");
  expect(() => verifyPersonalBackends(resources)).not.toThrow();
  rmSync(path.join(source, "node_modules/@clisbot/hub/dist/index.js"));
  await createPackage(source, path.join(resources, "app.asar"));
  uncache(path.join(resources, "app.asar"));
  expect(() => verifyPersonalBackends(resources)).toThrow("@clisbot/hub/dist/index.js");
  writeFileSync(path.join(source, "node_modules/@clisbot/hub/dist/index.js"), "export {};\n");
  rmSync(path.join(source, "node_modules/@clisbot/hub/.output/server/start-server.js"));
  await createPackage(source, path.join(resources, "app.asar"));
  uncache(path.join(resources, "app.asar"));
  expect(() => verifyPersonalBackends(resources)).toThrow(
    "@clisbot/hub/.output/server/start-server.js",
  );
});
