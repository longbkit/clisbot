const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// The Docker image runs the same script against its installed Hub.
const HUB_SMOKE = path.resolve(
  __dirname,
  "../../../docker/base/rootfs/usr/local/lib/clisbot-hub-smoke.mjs",
);

/**
 * Start the packaged Hub from `app.asar` with the app's own Electron and load every
 * in-repo channel through the real loader. File checks prove the code is shipped;
 * this proves it resolves from inside the archive.
 */
function smokePackagedHubChannels({ executable, resourcesDirectory }) {
  if (!fs.existsSync(HUB_SMOKE))
    throw new Error(
      `Packaged channel smoke needs the repository checkout: ${HUB_SMOKE} is missing.`,
    );
  const result = spawnSync(
    executable,
    [
      path.join(
        resourcesDirectory,
        "app.asar.unpacked",
        "dist",
        "daemon",
        "node-entrypoint-runner.js",
      ),
      "node-script",
      HUB_SMOKE,
      path.join(resourcesDirectory, "app.asar", "node_modules", "@clisbot", "hub"),
    ],
    {
      env: { PATH: process.env.PATH, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0)
    throw new Error(`Packaged Hub could not load its channels:\n${output}`, {
      cause: result.error,
    });
  const loaded = output.match(/^Packaged channel loaded: .+$/gmu) ?? [];
  console.log(`Packaged Hub loaded ${loaded.length} channels from app.asar.`);
}

module.exports = { smokePackagedHubChannels };
