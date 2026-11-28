// Regenerates Clisbot's brand marks and lockups from the Flow / Ocean 02 kit.
//
//   node assets/brand/build.mjs
//
// Upstream's generator drew its own artwork here; Clisbot's canonical generator is
// scripts/branding/brand-assets.mjs (also run by scripts/branding/apply.mjs). See README.md.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brandAssetFiles } from "../../scripts/branding/brand-assets.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
for (const [file, text] of brandAssetFiles()) {
  if (!file.endsWith(".svg")) continue;
  const target = path.join(repoRoot, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
}
