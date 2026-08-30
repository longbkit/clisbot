import { PGlite } from "@electric-sql/pglite";
import { homedir } from "node:os";
const db = new PGlite(`${homedir()}/.clisbot-dev`);
await db.waitReady;
const c = await db.query(
  "select column_name from information_schema.columns where table_name='project_configuration_revisions'",
);
console.log("cols:", c.rows.map((r) => r.column_name).join(", "));
const rev = await db.query(
  "select * from project_configuration_revisions order by created_at desc limit 1",
);
const row = rev.rows[0];
const { source_evidence, ...rest } = row;
console.log("latest revision:", JSON.stringify(rest, null, 1).slice(0, 800));
await db.close();
