const fs = require("node:fs");
const path = require("node:path");
const { listPackage } = require("@electron/asar");

/** Check actual package contents on every build target before shipping an app. */
function verifyPersonalBackends(resourcesDirectory) {
  const entries = new Set(
    listPackage(path.join(resourcesDirectory, "app.asar")).map((entry) => entry.replace(/^\//, "")),
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

module.exports = { verifyPersonalBackends };
