const { spawnSync } = require("node:child_process");

/** Runs codesign and returns stdout and stderr together; `codesign -d` reports on stderr. */
function runCodesign(args) {
  const result = spawnSync("codesign", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`codesign ${args.join(" ")} failed: ${result.stderr || result.error}`);
  }
  return `${result.stdout}${result.stderr}`;
}

/** An unsigned bundle (signing disabled in the build config) has no signature to replace. */
function readSignature(appPath, run) {
  try {
    return run(["-dv", "--verbose=2", appPath]);
  } catch {
    return "";
  }
}

/**
 * Without a signing identity, electron-builder falls back to an ad-hoc signature but keeps
 * the hardened runtime. Library validation then rejects the separately signed
 * Electron Framework and the app aborts at launch ("different Team IDs"). An ad-hoc app
 * cannot be notarized, so the hardened runtime protects nothing here: sign the bundle
 * again as one ad-hoc unit without it. Developer ID builds are left untouched.
 */
function reSignAdhocWithoutHardenedRuntime(appPath, run = runCodesign) {
  if (!/^Signature=adhoc$/m.test(readSignature(appPath, run))) return false;
  run(["--force", "--deep", "--sign", "-", appPath]);
  return true;
}

module.exports = { reSignAdhocWithoutHardenedRuntime };
