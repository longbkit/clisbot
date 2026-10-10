const fs = require("node:fs");
const path = require("node:path");
const { extractFile, listPackage } = require("@electron/asar");

/** Check actual package contents on every build target before shipping an app. */
function verifyPersonalBackends(resourcesDirectory) {
  const archive = path.join(resourcesDirectory, "app.asar");
  const entries = new Set(
    listPackage(archive).map((entry) => entry.replaceAll("\\", "/").replace(/^\/+/, "")),
  );
  const required = [
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
    ...inRepoChannelFiles(archive),
  ];
  const missing = required.filter((entry) => !entries.has(entry));
  if (!fs.existsSync(path.join(resourcesDirectory, "app-dist", "index.html")))
    missing.push("app-dist/index.html");
  if (
    !fs.existsSync(
      path.join(
        resourcesDirectory,
        "app.asar.unpacked",
        "dist",
        "daemon",
        "node-entrypoint-runner.js",
      ),
    )
  )
    missing.push("app.asar.unpacked/dist/daemon/node-entrypoint-runner.js");
  if (missing.length)
    throw new Error(`Desktop is missing personal serving assets: ${missing.join(", ")}`);
}

/**
 * Every channel the shipped Hub loads from its own packages, read from the shipped
 * `channel-pins.json`: a channel missing here fails only when a user connects it.
 */
function inRepoChannelFiles(archive) {
  const pinsPath = "node_modules/@clisbot/hub/channel-pins.json";
  let pins;
  try {
    pins = JSON.parse(extractFile(archive, path.normalize(pinsPath)).toString("utf8"));
  } catch {
    return [pinsPath];
  }
  return Object.values(pins.channels)
    .filter((pin) => pin.loadMode === "in-repo")
    .flatMap((pin) =>
      [pin.entry, pin.plugin.specifier].map((file) =>
        path.posix.join("node_modules", pin.inRepoPackage, file),
      ),
    );
}

module.exports = { verifyPersonalBackends };
