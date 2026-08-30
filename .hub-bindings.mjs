#!/usr/bin/env node
// Inspect (and optionally delete) thread_bindings rows for the telegram account
// work in the clisbot-dev Hub DB. RUN ONLY WHILE THE HUB IS STOPPED.
// Usage: node .hub-bindings.mjs list | delete <conversationId>
import { PGlite } from "@electric-sql/pglite";
import { homedir } from "node:os";

const DIR = `${homedir()}/.clisbot-dev`;
const db = new PGlite(DIR);
await db.waitReady;

const [cmd, target] = process.argv.slice(2);

const rows = await db.query(
  `select b.id, b.channel, b.account_id, b.external_conversation_id, b.external_thread_id,
          b.status, b.agent_id, b.initiator, b.created_at, b.resolved_at,
          b.route ->> 'agentName' as agent_name
   from thread_bindings b
   where b.account_id = 'work'
   order by b.created_at`,
);

for (const r of rows.rows) {
  console.log(
    `${r.channel}/${r.account_id} conv=${r.external_conversation_id} thread=${r.external_thread_id} ` +
      `status=${r.status} agentId=${r.agent_id} routeAgent=${r.agent_name} ` +
      `created=${r.created_at} resolved=${r.resolved_at} row=${r.id}`,
  );
}
console.log(`total rows: ${rows.rows.length}`);

if (cmd === "delete") {
  if (!target) {
    console.error("delete requires a conversationId");
    process.exit(2);
  }
  const res = await db.query(
    `delete from thread_bindings where account_id = 'work' and external_conversation_id = $1 returning id, agent_id, status`,
    [target],
  );
  console.log(`deleted ${res.rows.length} row(s):`, JSON.stringify(res.rows));
}

await db.close();
