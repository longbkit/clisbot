#!/usr/bin/env node
// Wave-8 operator writer (fork of `.hub-revision-write15.mjs`, same store:
// `loadChannelControlPlane` + `deployRevision`): give a Route a default Agent
// (`agentControls:`) instead of editing the `hub.yml` profile that other Routes
// and Automations share. That leaf is what the app's Route editor and
// `/promoteroutedefault` write; a conversation may still override it with
// `/provider` / `/model`, and only the next session on the Route uses it.
//
// Invariant (STOP < WRITE < START): runs ONLY while the Hub is down — the
// PGlite cluster in $CLISBOT_HOME is locked by the running Hub.
//
// Scenarios:
//   dump         -> read-only: print the active revision's files, write nothing.
//   omp-defaults -> set `agentControls: { provider: omp }` on the account's DM
//                   route and its "every group" route. Nothing else moves.
//
// Usage: node .hub-revision-write16.mjs dump|omp-defaults [--dry]
import { resolve } from "node:path";
import { load, dump as dumpYaml } from "js-yaml";

const repoRoot = resolve(new URL(".", import.meta.url).pathname);
const { configureRuntimeRoot } = await import(`${repoRoot}/packages/hub/dist/runtime-files.js`);
configureRuntimeRoot(resolve(repoRoot, "packages/hub"));
const { createEmbeddedRuntime } = await import(
  `${repoRoot}/packages/hub/dist/db/runtime/internal/embedded.js`
);
const { createDatabase } = await import(`${repoRoot}/packages/hub/dist/db/pg.js`);
const { loadChannelControlPlane } = await import(
  `${repoRoot}/packages/hub/dist/channels/control-plane.js`
);
const { deployRevision } = await import(
  `${repoRoot}/packages/hub/dist/channels/http/configuration.js`
);

const DATA_DIR = process.env.HUB_DATA_DIR;
const scenario = process.argv[2];
const dry = process.argv.includes("--dry");
const t0 = Date.now();
const log = (x) => console.log(`[t+${Date.now() - t0}ms] ${x}`);
const fail = (m) => {
  console.error(`\nABORT: ${m}`);
  process.exit(1);
};
if (!["dump", "omp-defaults"].includes(scenario ?? "")) {
  fail("usage: node .hub-revision-write16.mjs dump|omp-defaults [--dry]");
}

const TELEGRAM_FILE = ".paseo/channels/telegram/aitran.yml";
// The Route's default Agent controls. `omp` alone would start Oh My Pi on
// whatever model it picks by default; the pinned model is the one the operator
// wants these Routes to run.
const CONTROLS = { provider: "omp", model: "opencode-go/deepseek-v4.1-flash" };

/** The Where that decides which Route this is: DM, or every group. */
function routeWhere(route) {
  const rules = Array.isArray(route?.audience) ? route.audience : [];
  if (rules.some((rule) => rule?.where?.dm === true)) return "dm";
  if (rules.some((rule) => rule?.where?.groups === "all")) return "groups";
  return undefined;
}

function transform(files) {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const content = byPath.get(TELEGRAM_FILE);
  if (content === undefined) fail(`${TELEGRAM_FILE} is not in the active revision`);
  let doc;
  try {
    doc = load(content);
  } catch (error) {
    fail(`${TELEGRAM_FILE}: ${error.message}`);
  }
  const routes = Array.isArray(doc?.routes) ? doc.routes : [];
  let hits = 0;
  routes.forEach((route, position) => {
    const where = routeWhere(route);
    if (where === undefined) return;
    const before = route.agentControls === undefined ? "none" : JSON.stringify(route.agentControls);
    route.agentControls = { ...CONTROLS };
    hits += 1;
    log(
      `${TELEGRAM_FILE}: routes[${position}] where=${where} agentControls ${before} -> ${JSON.stringify(CONTROLS)}`,
    );
  });
  if (hits === 0) fail("no DM or every-group route found — inspect the dump first");
  byPath.set(TELEGRAM_FILE, dumpYaml(doc, { noRefs: true, lineWidth: -1 }));
  return [...byPath.entries()].map(([path, content]) => ({ path, content }));
}

const runtime = await createEmbeddedRuntime(DATA_DIR);
const database = createDatabase(runtime.runtime, runtime.locks);
const snapshot = await loadChannelControlPlane(database);
log(
  `active revision ${snapshot.revision?.id ?? "none"} v${snapshot.revision?.version ?? 0} (${snapshot.files.length} files)`,
);
if (scenario === "dump") {
  for (const file of snapshot.files) console.log(`\n==== ${file.path} ====\n${file.content}`);
  await database.close();
  process.exit(0);
}
const files = transform(snapshot.files);
console.log(`\n---- ${TELEGRAM_FILE} (transformed) ----`);
console.log(files.find((f) => f.path === TELEGRAM_FILE).content);
if (dry) {
  log("--dry: nothing was written");
  await database.close();
  process.exit(0);
}
const warnings = await deployRevision(database, snapshot, files, {
  expectedRevisionId: snapshot.revision?.id ?? null,
});
if (warnings.length > 0) console.log(`warnings: ${JSON.stringify(warnings, null, 1)}`);
const after = await loadChannelControlPlane(database);
console.log(
  `\nRESULT scenario=${scenario} revision=${after.revision?.id} v${after.revision?.version}`,
);
await database.close();
