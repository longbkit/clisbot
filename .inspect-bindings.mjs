import { PGlite } from "@electric-sql/pglite";
import { homedir } from "node:os";
const db = new PGlite(`${homedir()}/.clisbot-dev`);
await db.waitReady;
const r = await db.query(`
  select external_conversation_id, external_thread_id, channel, account_id, status, agent_id, initiator, created_at,
         route
  from thread_bindings order by created_at`);
for (const row of r.rows) {
  const route = row.route ?? {};
  console.log(
    JSON.stringify({
      conv: row.external_conversation_id,
      thread: row.external_thread_id,
      channel: row.channel,
      account: row.account_id,
      status: row.status,
      agentId: row.agent_id,
      initiator: row.initiator,
      created: row.created_at,
      routeAgent: route.agent ?? route.agentName ?? route.agent_name ?? null,
    }),
  );
}
await db.close();
