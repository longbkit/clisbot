import { PGlite } from "@electric-sql/pglite";
import { homedir } from "node:os";
const db = new PGlite(`${homedir()}/.clisbot-dev`);
await db.waitReady;
const rev = await db.query(
  `select id, version, created_at, current from project_configuration_revisions order by created_at desc limit 5`,
);
console.log("=== revisions ===");
for (const r of rev.rows) console.log(JSON.stringify(r).slice(0, 300));
const active = rev.rows.find((r) => r.current === true || r.current === 1) ?? rev.rows[0];
const files = await db.query(`select * from project_configuration_sources where revision_id = $1`, [
  active.id,
]);
for (const f of files.rows) {
  console.log(`\n==== ${f.file_path ?? f.path ?? "?"} ====`);
  console.log(String(f.content ?? f.file_content ?? "").slice(0, 4000));
}
await db.close();
