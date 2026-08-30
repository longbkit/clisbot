import { PGlite } from "@electric-sql/pglite";
import { homedir } from "node:os";
const db = new PGlite(`${homedir()}/.clisbot-dev`);
await db.waitReady;
const r = await db.query(
  `select raw_yaml from project_configuration_revisions where id='b1d2218f-7f8e-4886-9d73-00085909702e'`,
);
console.log(r.rows[0].raw_yaml);
await db.close();
