import { PGlite } from "@electric-sql/pglite";
import { homedir } from "node:os";
const db = new PGlite(`${homedir()}/.clisbot-dev`);
await db.waitReady;
const r = await db.query(
  `select normalized_configuration from project_configuration_revisions where id='b1d2218f-7f8e-4886-9d73-00085909702e'`,
);
const n = r.rows[0].normalized_configuration;
console.log(JSON.stringify(n, null, 1).slice(0, 6000));
await db.close();
