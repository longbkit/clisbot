#!/usr/bin/env node
// Slice-12 live-E2E binding inspector / reset. Runs only while the Hub is
// down (the PGlite cluster in $CLISBOT_HOME is locked by a running Hub).
//
// Why it exists: a channel-configuration revision invalidates every live
// thread binding whose captured route selection no longer matches
// (`execution.ts routeForBinding` -> `invalid-binding`), and the plane then
// ignores every further inbound in that conversation with no in-channel
// recovery (`/new` is parsed after route resolution). Between revisions the
// lane clears the bindings so the next marker binds a fresh session.
//
// Usage: node .hub-bindings12.mjs list|clear
import { homedir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(new URL(".", import.meta.url).pathname);
const { configureRuntimeRoot } = await import(`${repoRoot}/packages/hub/dist/runtime-files.js`);
configureRuntimeRoot(resolve(repoRoot, "packages/hub"));
const { createEmbeddedRuntime } = await import(
  `${repoRoot}/packages/hub/dist/db/runtime/internal/embedded.js`
);

const DATA_DIR = process.env.CLISBOT_HOME || `${homedir()}/.clisbot-dev`;
const mode = process.argv[2] ?? "list";
const runtime = await createEmbeddedRuntime(DATA_DIR);
const rows = async (sql) => (await runtime.runtime.query(sql)).rows;
const before = await rows(
  `select id, channel, account_id, external_conversation_id, external_thread_id, agent_id, status
   from thread_bindings order by created_at`,
);
for (const row of before) console.log(JSON.stringify(row));
if (mode === "clear") {
  await runtime.runtime.query(`delete from thread_bindings`);
  console.log(`cleared ${before.length} binding(s)`);
}
await runtime.runtime.close?.();
