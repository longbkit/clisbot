import { PGlite } from "@electric-sql/pglite";
import { homedir } from "node:os";
const db = new PGlite(`${homedir()}/.clisbot-dev`);
await db.waitReady;
const r = await db.query(
  `select source_evidence from project_configuration_revisions where id='b1d2218f-7f8e-4886-9d73-00085909702e'`,
);
const ev = r.rows[0].source_evidence;
for (const f of ev.bundle?.files ?? []) {
  console.log(`\n======== ${f.path} ========`);
  console.log(f.content);
}
await db.close();
