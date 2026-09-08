#!/usr/bin/env node
// Wave-6 live-E2E channel revision writer (fork of `.hub-revision-write12.mjs`,
// same store: `loadChannelControlPlane` + `deployRevision`).
//
// Invariant (STOP < WRITE < START): runs ONLY while the Hub is down — the
// PGlite cluster in $CLISBOT_HOME is locked by the running Hub. The dev daemon
// (127.0.0.1:6867, ~/.clisbot-dev) stays up; never ~/.paseo, never 6767.
//
// Scenarios:
//   dump   -> read-only: print the active revision's files, write nothing.
//   sonnet -> repoint the live channel agent target(s) from
//             `codex`/`gpt-5.6-luna` (which answers "Selected model is at
//             capacity" on roughly every other request — wave 5b) to the
//             `claude` provider with `claude-sonnet-5`. Nothing else moves:
//             outbound.path, sync.streaming, approval grants, access and the
//             policy file are all carried through untouched.
//
// Usage: node .hub-revision-write13.mjs dump|sonnet
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
if (!["dump", "sonnet"].includes(scenario ?? "")) {
  fail("usage: node .hub-revision-write13.mjs dump|sonnet");
}

const PROVIDER = "claude";
const MODEL = "claude-sonnet-5";

function retargetAgentDefinition(agent) {
  // A hub.yml agent definition: { provider, model, ... }. Only the two model
  // keys move; mode/options/workspace/etc. stay as authored.
  if (agent === null || typeof agent !== "object") return { changed: false };
  const before = `${agent.provider ?? "?"}/${agent.model ?? "?"}`;
  agent.provider = PROVIDER;
  agent.model = MODEL;
  return { changed: true, before, after: `${PROVIDER}/${MODEL}` };
}

function transform(files) {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  let hits = 0;
  for (const [path, content] of byPath) {
    if (!path.endsWith(".yml") && !path.endsWith(".yaml")) continue;
    let doc;
    try {
      doc = load(content);
    } catch (error) {
      fail(`${path}: ${error.message}`);
    }
    if (doc === null || typeof doc !== "object") continue;
    let touched = false;
    // hub.yml-style named agents: `agents: { <name>: { provider, model } }`.
    const agents = doc.agents;
    if (agents !== null && typeof agents === "object" && !Array.isArray(agents)) {
      for (const [name, agent] of Object.entries(agents)) {
        const result = retargetAgentDefinition(agent);
        if (!result.changed) continue;
        touched = true;
        hits += 1;
        log(`${path}: agents.${name} ${result.before} -> ${result.after}`);
      }
    }
    if (Array.isArray(agents)) {
      for (const agent of agents) {
        const target = agent?.agent ?? agent;
        const result = retargetAgentDefinition(target);
        if (!result.changed) continue;
        touched = true;
        hits += 1;
        log(`${path}: agents[${agent?.name ?? "?"}] ${result.before} -> ${result.after}`);
      }
    }
    // Inline route targets: `routes[].agent: { provider, model }` (the schema
    // allows a string name too — those resolve through `agents` above).
    for (const route of Array.isArray(doc.routes) ? doc.routes : []) {
      if (typeof route?.agent !== "object" || route.agent === null) continue;
      const result = retargetAgentDefinition(route.agent);
      if (!result.changed) continue;
      touched = true;
      hits += 1;
      log(`${path}: routes[${route.match?.kind ?? "?"}].agent ${result.before} -> ${result.after}`);
    }
    if (touched) byPath.set(path, dumpYaml(doc, { noRefs: true, lineWidth: -1 }));
  }
  if (hits === 0) fail("no agent target found to retarget — inspect the dump first");
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
for (const file of files) log(`---- ${file.path} ----\n${file.content}`);
await deployRevision(database, snapshot, files, {
  expectedRevisionId: snapshot.revision?.id ?? null,
});
const after = await loadChannelControlPlane(database);
console.log(
  `\nRESULT scenario=${scenario} revision=${after.revision?.id} v${after.revision?.version}`,
);
await database.close();
