import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// In-repo channel packages are ordinary dependencies of `@clisbot/hub`, so the
// Hub finds them the way Node does: through its own module resolution. That
// holds in the repo (workspace links in the root node_modules), in an npm
// install, in the Docker image and inside the desktop's app.asar. Never derive
// these paths from this file's location: the compiled and bundled Hub sit at
// different depths, and a guessed path fails only on the build that ships.

const require = createRequire(import.meta.url);

/** The real directory of an in-repo channel package the Hub depends on. */
export function resolveInRepoPackageDir(packageName: string): string {
  try {
    // `realpath` follows a workspace link out of node_modules to the package.
    return realpathSync(dirname(require.resolve(`${packageName}/package.json`)));
  } catch (error) {
    throw new Error(
      `channel package ${packageName} is not installed with the Hub; it must be listed in @clisbot/hub dependencies`,
      { cause: error },
    );
  }
}

/**
 * The node_modules directory the channel packages are installed into. npm hoists
 * their third-party dependencies (grammy, @slack/*, ws) into the same directory.
 */
export function channelNodeModulesDir(packageName: string): string {
  const searched = require.resolve.paths(packageName) ?? [];
  const dir = searched.find((candidate) =>
    existsSync(join(candidate, packageName, "package.json")),
  );
  if (dir === undefined)
    throw new Error(`channel package ${packageName} is not installed with the Hub`);
  return dir;
}
