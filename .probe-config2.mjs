import { PGlite } from "@electric-sql/pglite";
import { homedir } from "node:os";
const db = new PGlite(`${homedir()}/.clisbot-dev`);
await db.waitReady;
const cols = await db.query(
  `select column_name from information_schema.columns where table_name='project_configuration_revisions' order by ordinal_position`,
);
console.log("REVISION COLS:", cols.rows.map((r) => r.column_name).join(", "));
const revs = await db.query(
  `select * from project_configuration_revisions order by created_at desc limit 3`,
);
for (const r of revs.rows) console.log(JSON.stringify(r).slice(0, 500));
const srcCols = await db.query(
  `select column_name from information_schema.columns where table_name='project_configuration_sources' order by ordinal_position`,
);
console.log("SOURCE COLS:", srcCols.rows.map((r) => r.column_name).join(", "));
await db.close();
