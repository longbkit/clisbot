import { PGlite } from "@electric-sql/pglite";
import { homedir } from "node:os";
const db = new PGlite(`${homedir()}/.clisbot-dev`);
await db.waitReady;
const cols = await db.query(
  `select column_name from information_schema.columns where table_name='delivery_ledger'`,
);
console.log("LEDGER COLS:", cols.rows.map((r) => r.column_name).join(", "));
const ledger = await db.query(
  `select * from delivery_ledger order by posted_at desc nulls last limit 20`,
);
console.log("=== LEDGER (latest 20) ===");
for (const r of ledger.rows) {
  console.log(JSON.stringify(r).slice(0, 600));
}
await db.close();
