// Seam-matrix generator — static import-graph classification of a pinned channel's
// `openclaw/plugin-sdk/*` subpaths against the pinned main package (plan §7 / §9
// step 2–3). This is the machine-checked half of the surface-matrix discipline:
// every subpath the channel dist imports lands as passthrough / bound /
// unsupported with a reason, and every named import is conformance-checked
// against the main package's exports.
//
// Run:  node seam-matrix/generate.mjs
// Reads:  /tmp/openclaw-scout (or $OPENCLAW_SCOUT_DIR) — the unpacked dists
// Writes: seam-matrix/slack.json (reviewable, CI artifact)
//         src/channels/loader/seam-matrix.ts (loader-consumed, generated)
//
// The classification rule (plan §7): a subpath is **bound** when the host must
// supply behavior (agent loop, sessions, state, gateway, outbound); **passthrough**
// when the import graph stays in pure SDK logic; **unsupported** when neither
// applies this phase. For P0 the only subpath on the inbound path that drives the
// agent is `channel-inbound` (its `dispatchChannelInboundReply`); every other
// imported subpath is pure OpenClaw SDK logic that loads as-is from the main
// package, so it is passthrough. The bound export list is the load-time proof that
// the seam is exactly as wide as the plan says — no wider.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const repoRoot = resolve(here, "..");
const scoutDir = process.env["OPENCLAW_SCOUT_DIR"] ?? "/tmp/openclaw-scout";
const slackDist = join(scoutDir, "slack", "package", "dist");
const mainPkgDir = join(scoutDir, "main", "package");

// --- import-graph extraction -------------------------------------------------
// Capture: import { a, b as c } from "openclaw/plugin-sdk/x" | import * as n
// from "…" | import n from "…" | dynamic import("openclaw/plugin-sdk/x").
const IMPORT_RE =
  /import\s+(?:\*\s*as\s+([A-Za-z_$][\w$]*)|(?:\{([^}]*)\})\s*(?:,\s*)?([A-Za-z_$][\w$]*)?)\s*from\s*"([^"]+)"|import\(\s*"([^"]+)"\s*\)/g;

/** Record the named imports of one `{ a, b as c }` block into `names`. */
function addNamedImports(names, namedBlock) {
  for (const part of namedBlock.split(",")) {
    const p = part.trim();
    if (!p) continue;
    names.add(p.includes(" as ") ? p.split(" as ")[0].trim() : p);
  }
}

function extractImports(dir) {
  const subpaths = new Map(); // specifier -> Set(named)
  const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    const src = readFileSync(join(dir, file), "utf8");
    let m;
    while ((m = IMPORT_RE.exec(src)) !== null) {
      const star = m[1];
      const namedBlock = m[2];
      const defaultName = m[3];
      const spec = m[4] ?? m[5];
      if (!spec) continue;
      if (!spec.startsWith("openclaw/") && !spec.startsWith("@openclaw/")) continue;
      const set = subpaths.get(spec) ?? new Set();
      if (star) set.add("*");
      if (defaultName) set.add(defaultName);
      if (namedBlock) addNamedImports(set, namedBlock);
      subpaths.set(spec, set);
    }
    // The regex above misses two real import forms: bare side-effect imports
    // (`import "openclaw/plugin-sdk/x";`) and dynamic imports through a const
    // (`import(CONST_MODULE_ID)`), both present in the pinned slack dist. Scan
    // every quoted plugin-sdk specifier as a second pass — named imports are
    // already recorded above, so this only widens the subpath set.
    for (const lit of src.matchAll(/"(openclaw\/plugin-sdk\/[^"]+)"/g)) {
      subpaths.set(lit[1], subpaths.get(lit[1]) ?? new Set());
    }
  }
  return subpaths;
}

// --- main-package export surface ---------------------------------------------
function listMainSdkFiles() {
  const dir = join(mainPkgDir, "dist", "plugin-sdk");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => f.slice(0, -3));
}

// --- classification ------------------------------------------------------------
// The bound subpath + the host-supplied exports (the load-time seam). Every
// imported subpath not here is passthrough (pure SDK logic, loads from main).
const BOUND = {
  "openclaw/plugin-sdk/channel-inbound": {
    reason:
      "Inbound dispatch to the Hub (plan §7): the vertical's prepared message is handed the host through dispatchChannelInboundReply; the host drives the real agent + relay. The pure normalizers in the same subpath stay OpenClaw's.",
    hostModule: "hosts/channel-inbound.ts",
    hostExports: [
      "dispatchChannelInboundReply",
      "runChannelInboundEvent",
      "runPreparedInboundReply",
      "dispatchReplyFromConfigWithSettledDispatcher",
    ],
  },
};

function classify(subpaths, mainFiles) {
  const matrix = {};
  const counts = { bound: 0, passthrough: 0, unsupported: 0 };
  for (const [spec, names] of [...subpaths.entries()].sort()) {
    const inMain = mainFiles.includes(spec.replace("openclaw/plugin-sdk/", ""));
    const bound = BOUND[spec];
    let entry;
    if (bound) {
      counts.bound += 1;
      entry = {
        classification: "bound",
        reason: bound.reason,
        hostModule: bound.hostModule,
        hostExports: bound.hostExports,
        namedImports: [...names].sort(),
      };
    } else if (inMain) {
      counts.passthrough += 1;
      entry = {
        classification: "passthrough",
        reason: "Pure OpenClaw SDK logic; loads from the pinned main package.",
        namedImports: [...names].sort(),
      };
    } else {
      counts.unsupported += 1;
      entry = {
        classification: "unsupported",
        reason: `No such subpath in the pinned main package (${spec}).`,
        namedImports: [...names].sort(),
      };
    }
    matrix[spec] = entry;
  }
  return { matrix, counts };
}

function main() {
  const subpaths = extractImports(slackDist);
  const mainFiles = listMainSdkFiles();
  const { matrix, counts } = classify(subpaths, mainFiles);

  // Conformance: every named import of a passthrough/bound subpath must exist in
  // the main package's module exports (plan §9 step 2–3). This static check reads
  // the main subpath file's export names (top-level `export { … }` / `export
  // const/function/class`).
  const missing = [];
  for (const [spec, entry] of Object.entries(matrix)) {
    if (entry.classification === "unsupported") continue;
    const sub = spec.replace("openclaw/plugin-sdk/", "");
    const file = join(mainPkgDir, "dist", "plugin-sdk", `${sub}.js`);
    if (!exists(file)) continue;
    const exported = exportedNames(readFileSync(file, "utf8"));
    for (const name of entry.namedImports) {
      if (name === "*") continue;
      if (!exported.has(name)) missing.push({ spec, name });
    }
  }

  const out = {
    $generated: new Date().toISOString(),
    channel: "slack",
    mainPackage: "openclaw@2026.7.1-2",
    counts,
    subpaths: matrix,
    conformance: { checked: Object.keys(matrix).length, missing },
  };
  writeFileSync(join(here, "slack.json"), `${JSON.stringify(out, null, 2)}\n`);
  writeTs(matrix, counts, missing);
  console.log(
    `slack matrix: ${counts.bound} bound, ${counts.passthrough} passthrough, ${counts.unsupported} unsupported; conformance missing=${missing.length}`,
  );
  if (missing.length > 0) console.error(JSON.stringify(missing, null, 2));
}

function exists(p) {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}

function exportedNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const p = part.trim();
      if (!p) continue;
      const name = p.includes(" as ") ? p.split(" as ")[1].trim() : p;
      names.add(name);
    }
  }
  for (const m of src.matchAll(
    /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/export\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  return names;
}

function writeTs(matrix, counts, missing) {
  const lines = [];
  lines.push("// GENERATED by seam-matrix/generate.mjs — do not edit by hand.");
  lines.push("// Static import-graph classification of @openclaw/slack's");
  lines.push("// `openclaw/plugin-sdk/*` subpaths against openclaw@2026.7.1-2.");
  lines.push("// The loader consumes BOUND_SUBPATHS (the seam) and PASSTHROUGH_SUBPATHS;");
  lines.push("// everything else is an unclassified subpath → typed throw at load.");
  lines.push("");
  lines.push('export type SeamClassification = "bound" | "passthrough" | "unsupported";');
  lines.push("");
  lines.push("export interface BoundSubpath {");
  lines.push("  hostModule: string;");
  lines.push("  hostExports: readonly string[];");
  lines.push("  reason: string;");
  lines.push("}");
  lines.push("");
  lines.push("export const BOUND_SUBPATHS: Record<string, BoundSubpath> = {");
  for (const [spec, e] of Object.entries(matrix)) {
    if (e.classification !== "bound") continue;
    lines.push(
      `  ${JSON.stringify(spec)}: { hostModule: ${JSON.stringify(e.hostModule)}, hostExports: [${e.hostExports.map((s) => JSON.stringify(s)).join(", ")}], reason: ${JSON.stringify(e.reason)} },`,
    );
  }
  lines.push("};");
  lines.push("");
  lines.push("export const PASSTHROUGH_SUBPATHS: readonly string[] = [");
  for (const [spec, e] of Object.entries(matrix)) {
    if (e.classification !== "passthrough") continue;
    lines.push(`  ${JSON.stringify(spec)},`);
  }
  lines.push("];");
  lines.push("");
  lines.push(
    `export const SEAM_COUNTS: { bound: number; passthrough: number; unsupported: number } = ${JSON.stringify(counts)};`,
  );
  lines.push("");
  lines.push(
    `export const IMPORT_CONFORMANCE_MISSING: readonly { spec: string; name: string }[] = ${JSON.stringify(missing)};`,
  );
  lines.push("");
  writeFileSync(resolve(repoRoot, "src/channels/loader/seam-matrix.ts"), lines.join("\n"));
}

main();
