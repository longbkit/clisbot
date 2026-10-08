import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { channelPackageDirs } from "../scripts/channel-packages.mjs";

// Run only in the disposable Docker build context. Pack compiled private
// workspaces locally so the image never fetches their names from npm.
const workspaces = channelPackageDirs();
const versions = new Map(
  workspaces.map((workspace) => {
    const pkg = JSON.parse(readFileSync(`${workspace}/package.json`, "utf8"));
    return [pkg.name, pkg.version];
  }),
);
for (const workspace of workspaces) {
  execFileSync("npm", ["run", "build", "--workspace", workspace], { stdio: "inherit" });
  const path = `${workspace}/package.json`;
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  // npm's '*' range excludes prereleases outside a workspace. Pin these local
  // packs to each other so a beta image never falls back to registry packages.
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    if (versions.has(name)) pkg.dependencies[name] = versions.get(name);
  }
  pkg.files = ["dist", "LICENSE", "NOTICE", "SYNC.md", "upstream-sync.json"];
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  execFileSync(
    "npm",
    ["pack", "--workspace", workspace, "--pack-destination", "/tmp/clisbot-packs"],
    { stdio: "inherit" },
  );
}
