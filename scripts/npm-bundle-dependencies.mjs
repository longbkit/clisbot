import { cp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// npm pack only sees bundles inside the package's own node_modules. npm workspace
// installs hoist them, so stage their installed production closure before packing.
export async function stageBundleDependencies(
  workspace,
  installationRoot = fileURLToPath(new URL("../", import.meta.url)),
) {
  workspace = await realpath(workspace);
  installationRoot = await realpath(installationRoot);
  const lock = JSON.parse(await readFile(path.join(installationRoot, "package-lock.json"), "utf8"));
  const locked = (directory) =>
    lock.packages[path.relative(installationRoot, directory).split(path.sep).join("/")];
  const manifest = JSON.parse(await readFile(path.join(workspace, "package.json"), "utf8"));
  const packages = new Map();
  const moduleRoots = [];
  for (let directory = workspace; ; directory = path.dirname(directory)) {
    moduleRoots.push(path.join(directory, "node_modules"));
    if (path.dirname(directory) === directory) break;
  }

  const graph = { locked, packages, moduleRoots, workspace };
  for (const name of manifest.bundleDependencies ?? []) await collect(name, workspace, graph);
  // Resolve the whole graph before copying so staging cannot change resolution.
  for (const [source, destination] of packages) {
    if (source === destination) {
      await isolateOptionalPeers(source, destination, graph);
      continue;
    }
    // Only generated, non-lockfile paths are replaced. Resolving through the lock
    // above prevents a previous build's staged copy from hiding an updated module.
    await rm(destination, { recursive: true, force: true });
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, {
      recursive: true,
      filter: (entry) => !path.relative(source, entry).split(path.sep).includes("node_modules"),
    });
    await isolateOptionalPeers(source, destination, graph);
  }
}

async function isolateOptionalPeers(source, destination, { packages, locked }) {
  const upstream = path.join(source, "package.json.upstream");
  const original = await readFile(
    existsSync(upstream) ? upstream : path.join(source, "package.json"),
    "utf8",
  );
  const pkg = JSON.parse(original);
  const require = createRequire(path.join(source, "package.json"));
  let changed = false;
  for (const name of Object.keys(pkg.peerDependencies ?? {})) {
    const peer = require.resolve
      .paths(name)
      ?.map((directory) => path.join(directory, name))
      .find((directory) => locked(directory) && existsSync(path.join(directory, "package.json")));
    if (peer && packages.has(await realpath(peer))) continue;
    if (!pkg.peerDependenciesMeta?.[name]?.optional)
      throw new Error(`Required peer ${name} is outside the bundle for ${pkg.name}`);
    // npm considers peers at the bundler's level to be bundled, even when their
    // files are absent. Leave external integrations to the host's dependencies.
    delete pkg.peerDependencies[name];
    delete pkg.peerDependenciesMeta[name];
    changed = true;
  }
  if (!changed) return;
  if (pkg.files) pkg.files = [...pkg.files, "package.json.upstream"];
  await writeFile(path.join(destination, "package.json.upstream"), original);
  await writeFile(path.join(destination, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
}

async function collect(name, from, graph, optional = false) {
  const { locked, packages, moduleRoots, workspace } = graph;
  const require = createRequire(path.join(from, "package.json"));
  const source = require.resolve
    .paths(name)
    ?.map((directory) => path.join(directory, name))
    .find((directory) => locked(directory) && existsSync(path.join(directory, "package.json")));
  if (!source) {
    if (optional) return;
    throw new Error(`Missing bundled dependency ${name} from ${from}; run npm ci first`);
  }
  const directory = await realpath(source);
  if (packages.has(directory)) return;
  const pkg = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
  if (pkg.version !== locked(source).version)
    throw new Error(`Bundled dependency ${name} differs from package-lock.json; run npm ci first`);
  const root = moduleRoots.find((candidate) => directory.startsWith(candidate + path.sep));
  if (!root) throw new Error(`Bundled dependency is outside the npm installation: ${directory}`);
  const destination = path.join(workspace, "node_modules", path.relative(root, directory));
  if (directory !== destination && locked(destination))
    throw new Error(`Bundle would replace an installed dependency: ${destination}`);
  packages.set(directory, destination);
  for (const dependency of new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ])) {
    await collect(dependency, directory, graph, dependency in (pkg.optionalDependencies ?? {}));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await stageBundleDependencies(process.cwd());
}
