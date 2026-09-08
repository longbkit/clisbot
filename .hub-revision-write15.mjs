#!/usr/bin/env node
// Wave-7 live-E2E channel revision writer (fork of `.hub-revision-write14.mjs`,
// same store: `loadChannelControlPlane` + `deployRevision`).
//
// Invariant (STOP < WRITE < START): runs ONLY while the Hub is down — the
// PGlite cluster in $CLISBOT_HOME is locked by the running Hub. The dev daemon
// (127.0.0.1:6867, ~/.clisbot-dev) stays up; never ~/.paseo, never 6767.
//
// Scenarios:
//   dump             -> read-only: print the active revision's files, write nothing.
//   telegram-dm-tool -> attach the `message` tool to the Telegram dm and group
//                       routes (`outbound.path: tool`). Wave 6d attached it to
//                       the topic route only (revision 354df33c v7), so a reply
//                       in the basic group still went out through the reply path
//                       and the model had no channel tool there. Nothing else
//                       moves — the topic route, `sync.streaming`, `interaction`,
//                       `audience`, the agent and every other file are carried
//                       through untouched.
//
// Usage: node .hub-revision-write15.mjs dump|telegram-dm-tool
import { homedir } from "node:os";
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

const DATA_DIR = process.env.CLISBOT_HOME || `${homedir()}/.clisbot-dev`;
const scenario = process.argv[2];
const t0 = Date.now();
const log = (x) => console.log(`[t+${Date.now() - t0}ms] ${x}`);
const fail = (m) => {
  console.error(`\nABORT: ${m}`);
  process.exit(1);
};
if (!["dump", "telegram-dm-tool"].includes(scenario ?? "")) {
  fail("usage: node .hub-revision-write15.mjs dump|telegram-dm-tool");
}

const TELEGRAM_FILE = ".paseo/channels/telegram/onboarding-telegram.yml";
const ROUTE_KINDS = ["dm", "group"];

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
  let hits = 0;
  for (const route of Array.isArray(doc?.routes) ? doc.routes : []) {
    const kind = route?.match?.kind;
    if (!ROUTE_KINDS.includes(kind)) continue;
    const before = route.outbound?.path ?? "none";
    route.outbound = { ...(route.outbound ?? {}), path: "tool" };
    hits += 1;
    log(`${TELEGRAM_FILE}: routes[${kind}].outbound.path ${before} -> tool`);
  }
  if (hits === 0) fail(`no ${ROUTE_KINDS.join("/")} route found — inspect the dump first`);
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
log(`---- ${TELEGRAM_FILE} ----\n${files.find((f) => f.path === TELEGRAM_FILE).content}`);
await deployRevision(database, snapshot, files, {
  expectedRevisionId: snapshot.revision?.id ?? null,
});
const after = await loadChannelControlPlane(database);
console.log(
  `\nRESULT scenario=${scenario} revision=${after.revision?.id} v${after.revision?.version}`,
);
await database.close();
