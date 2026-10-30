import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = resolve(repoRoot, "packages/app");
const dist = resolve(appRoot, "dist");
const require = createRequire(import.meta.url);
const {
  MANIFEST_NAME,
  recordDesktopRenderer,
} = require("../packages/desktop/scripts/renderer-build.js");

if (!process.env.npm_execpath) throw new Error("Run through npm run build:desktop");
rmSync(resolve(dist, MANIFEST_NAME), { force: true });
const result = spawnSync(
  process.execPath,
  [process.env.npm_execpath, "exec", "--", "expo", "export", "--platform", "web"],
  { cwd: appRoot, env: { ...process.env, CLISBOT_WEB_PLATFORM: "electron" }, stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
recordDesktopRenderer(dist);
