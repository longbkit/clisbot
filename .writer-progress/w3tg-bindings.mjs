// Read-only: dump channel binding rows from the Hub PGlite.
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite("/home/node/.clisbot-dev");
await db.waitReady;
const tables = (
  await db.query(
    `select table_name from information_schema.tables
       where table_schema = 'public' and (table_name ilike '%bind%' or table_name ilike '%route%')`,
  )
).rows;
console.log(
  "binding-ish tables:",
  tables.map((t) => t.table_name),
);
for (const t of tables) {
  const rows = (await db.query(`select * from ${t.table_name} limit 25`)).rows;
  console.log(`\n=== ${t.table_name} (${rows.length}) ===`);
  for (const r of rows) {
    console.log(
      JSON.stringify(r)
        .slice(0, 350)
        .replace(/"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"/g, '"<uuid>"'),
    );
  }
}
await db.close();
