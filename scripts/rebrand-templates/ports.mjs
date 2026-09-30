// Apply to source defaults and current examples, never installed user config,
// historical evidence, generated bundles, or unrelated application port 3000s.
export function rebrandPorts(path, input) {
  if (path.includes("/e2e/") || path === "scripts/benchmark-terminal-latency.ts") {
    return protectDaemonPorts(input);
  }
  if (!isPortSource(path)) return input;
  // Old Fusion Hub also used 6868. Only its known Hub-only sources may map it;
  // doing this globally would corrupt Clisbot's new daemon port on repeat runs.
  const legacyHub =
    input.includes("const FORK_DEFAULT_HUB_PORT = 6868") ||
    input.includes("loopback :6868") ||
    input.includes("saved port, or 6868 when available");
  let result =
    legacyHub &&
    /^packages\/cli\/src\/commands\/hub\/(?:local-hub(?:\.test)?|start)\.ts$/.test(path)
      ? input.replace(/\b6868\b/g, "6870")
      : input.replace("const HUB_PORT = 6868", "const HUB_PORT = 6870");
  result = result.replace(/\b6767\b/g, "6868").replace(/\b6768\b/g, "6869");
  return rebrandHubPort(path, result);
}

function protectDaemonPorts(input) {
  // Keep guards for existing Paseo processes as well as the new Clisbot defaults.
  return input
    .replaceAll("/:(6767)\\b/", "/:(6767|6768|6868|6869)\\b/")
    .replaceAll("/:6767\\b/", "/:(6767|6768|6868|6869)\\b/")
    .replaceAll("/:(6767|6768)\\b/", "/:(6767|6768|6868|6869)\\b/")
    .replaceAll("[6767, 6768]", "[6767, 6768, 6868, 6869]")
    .replaceAll("port !== 6767 && port !== 6768", "![6767, 6768, 6868, 6869].includes(port)")
    .replaceAll("port === 6767 || port === 6768", "[6767, 6768, 6868, 6869].includes(port)")
    .replaceAll("port === 6767", "[6767, 6768, 6868, 6869].includes(port)")
    .replaceAll('port === "6767"', '["6767", "6768", "6868", "6869"].includes(port)')
    .replace(
      "  6767, // Installed daemon.",
      "  6767, // Legacy installed daemon.\n  6868, // Clisbot daemon.",
    )
    .replace(
      "  6768, // Developer daemon.",
      "  6768, // Legacy dev daemon.\n  6869, // Clisbot dev daemon.",
    );
}

function isPortSource(path) {
  if (/\/(e2e|assets|generated)\//.test(path) || path.endsWith("webview-html.ts")) return false;
  if (/(?:AGENTS|CLAUDE)\.md$/.test(path) || path.endsWith(".svg")) return false;
  if (path.includes("package-lock") || path.endsWith(".snap")) return false;
  return (
    /^(?:package\.json|(?:paseo|clisbot)\.json|README(?:\.[\w-]+)?\.md)$/.test(path) ||
    /^(?:docker|nix|public-docs)\//.test(path) ||
    path.startsWith(".github/workflows/") ||
    /^docs\/[^/]+\.md$/.test(path) ||
    path.startsWith("docs/guides/user-guide/") ||
    /^packages\/(?:app|client|cli|desktop|hub|protocol|server)\//.test(path) ||
    /^scripts\/(?:dev[.-]|(?:paseo|clisbot)-ios-simulator|measure-relay-latency)/.test(path) ||
    /^skills\/(?:paseo|clisbot)-help\//.test(path)
  );
}

function rebrandHubPort(path, input) {
  const portOnlyFiles = new Set([
    "docker/base/Dockerfile",
    "docker/base/rootfs/usr/local/lib/clisbot-healthcheck.mjs",
    "docker/smoke.mjs",
    "docs/docker.md",
    "packages/hub/.env.example",
    "packages/hub/README.md",
    "packages/hub/package.json",
    "packages/hub/compose.yml",
    "packages/hub/fly.toml",
    "packages/hub/fly.example.toml",
    "packages/hub/scripts/docker-smoke.sh",
    "public-docs/hub/self-hosting/index.md",
  ]);
  if (portOnlyFiles.has(path)) return input.replace(/\b3000\b/g, "6870");
  if (path === "packages/hub/src/index.ts") {
    return input.replace('process.env["PORT"] ?? "3000"', 'process.env["PORT"] ?? "6870"');
  }
  if (/^packages\/hub\/src\/channels\/control-plane(?:\.test)?\.ts$/.test(path)) {
    return input
      .replace('environment["PORT"] ?? "3000"', 'environment["PORT"] ?? "6870"')
      .replace("? port : 3000", "? port : 6870")
      .replace("entry, 3000 otherwise", "entry, 6870 otherwise")
      .replace("falling back to 3000", "falling back to 6870")
      .replace(/(assert\.equal\(hubListenPort\([^\n]+), 3000\);/g, "$1, 6870);");
  }
  return input;
}
