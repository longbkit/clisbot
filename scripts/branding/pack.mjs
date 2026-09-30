#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { kitRoot } from "./artwork.mjs";

execFileSync(process.execPath, [fileURLToPath(new URL("./verify.mjs", import.meta.url))], {
  stdio: "inherit",
});
copyFileSync(fileURLToPath(new URL("../../LICENSE", import.meta.url)), join(kitRoot, "LICENSE"));
const archive = join(kitRoot, "clisbot-brand-kit.zip");
rmSync(archive, { force: true });
execFileSync(
  "zip",
  [
    "-X",
    "-q",
    "-r",
    archive,
    "source",
    "fonts",
    "exports",
    "brand.json",
    "manifest.json",
    "README.md",
    "LICENSE",
    "PREVIEW.html",
    "preview.png",
  ],
  { cwd: kitRoot },
);
console.log(archive);
