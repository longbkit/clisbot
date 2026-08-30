#!/usr/bin/env node
// Read-only: dump the active channel configuration revision.
import { homedir } from "node:os";
import { createEmbeddedRuntime } from "./packages/hub/dist/db/runtime/internal/embedded.js";
import { createDatabase } from "./packages/hub/dist/db/pg.js";
import { revisionBundleFiles } from "./packages/hub/dist/configuration/store.js";

const DATA_DIR = process.env.CLISBOT_HOME || `${homedir()}/.clisbot-dev`;
const rt = await createEmbeddedRuntime(DATA_DIR);
const db = createDatabase(rt.runtime, rt.locks);
const orgs = await db.listOrganizationsForOperator();
if (orgs.length !== 1) throw new Error(`expected 1 organization, got ${orgs.length}`);
const project = await db.findProjectBySlugForOrganization(orgs[0].id, "default");
if (!project) throw new Error('no "default" project');
const active = await db.findActiveProjectConfiguration(project.id);
if (!active) throw new Error("no active configuration");
const files = revisionBundleFiles(active);
console.log(`ACTIVE revision ${active.id} v${active.version}`);
for (const f of files) {
  console.log(`\n==== ${f.path} ====`);
  console.log(f.content);
}
await db.close();
