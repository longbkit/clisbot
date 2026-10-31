const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const MANIFEST_NAME = "clisbot-desktop-renderer.json";

function collectHashes(root, relative = "", hashes = {}) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    if (name === MANIFEST_NAME) continue;
    if (entry.isDirectory()) collectHashes(root, name, hashes);
    else if (entry.isFile()) {
      hashes[name] = createHash("sha256")
        .update(fs.readFileSync(path.join(root, name)))
        .digest("hex");
    } else throw new Error(`Unsupported desktop renderer entry: ${name}`);
  }
  return hashes;
}

// Called only after the Electron-specific Expo export succeeds. Hash every exported
// file so a later generic web export cannot leave a valid but stale build receipt.
function recordDesktopRenderer(root) {
  const files = collectHashes(root);
  assertExport(files);
  fs.writeFileSync(
    path.join(root, MANIFEST_NAME),
    JSON.stringify({ version: 1, platform: "electron", files }, null, 2) + "\n",
  );
}

function assertExport(files) {
  if (!files["index.html"] || !Object.keys(files).some((name) => name.endsWith(".js"))) {
    throw new Error("Desktop renderer export must contain index.html and JavaScript assets");
  }
}

function verifyDesktopRenderer(root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_NAME), "utf8"));
    if (manifest.version !== 1 || manifest.platform !== "electron") {
      throw new Error("missing Electron export provenance");
    }
    const files = collectHashes(root);
    assertExport(files);
    const names = Object.keys(files).sort();
    if (
      JSON.stringify(names) !== JSON.stringify(Object.keys(manifest.files ?? {}).sort()) ||
      names.some((name) => files[name] !== manifest.files[name])
    ) {
      throw new Error("renderer files changed after the Electron export");
    }
  } catch (error) {
    throw new Error(
      `Refusing to package an unverified desktop renderer: ${error.message}. ` +
        "Run npm run build:desktop from the repository root.",
      { cause: error },
    );
  }
}

module.exports = { MANIFEST_NAME, recordDesktopRenderer, verifyDesktopRenderer };
