import { PGlite } from "@electric-sql/pglite";
const db = new PGlite("/tmp/hubdb-copy");
const t = await db.query("select table_name from information_schema.tables where table_schema='public' and (table_name like '%revision%' or table_name like '%channel_account%') order by 1");
console.log(t.rows.map(r=>r.table_name).join(", "));
