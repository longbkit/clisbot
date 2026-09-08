#!/usr/bin/env node
// Wave-7 live-E2E access provisioning for the isolated dev Hub.
//
// Why: HEAD `e27af21f3` authorizes the CONFIGURATION of every session a channel
// inbound mints against the SENDER's grants
// (`channels/bindings/index.ts:623` -> `commands-dispatch.ts:172` ->
// `commands-config.ts:341`). A sender whose channel identity is not linked to a
// Hub Member resolves to the organization's Guest grants, and this dev home has
// none, so every Telegram/Slack inbound is answered
// "This configuration is outside your AgentConfigurationGrant." and no session
// is minted. The live lane's senders (the Telegram master bot, the Slack user
// credential) are unlinked identities, so the lane needs the Guest grant that
// the feature's own user guide describes.
//
// What it writes, both as subject `guest`:
//   - one `daemon` row per active daemon with `daemon.connect` + `daemon.manage`
//     (`RESOURCE_ACCESS_LEVELS.daemon.administrator`), which
//     `AccessStore.resolveChannelAgentAccess` reads as `unrestricted: true`;
//   - one `channel_account` row per configured account with `channel.use` and
//     `constraints.conversation = { kind: "all" }`, without which
//     `authorizeChannelPrivilege` refuses before the daemon grant is read
//     (an absent conversation constraint covers nothing, `store.ts` conversationCovers).
//
// Invariant (STOP < WRITE < START): runs ONLY while the Hub is down — the
// PGlite cluster in $CLISBOT_HOME is locked by the running Hub.
//
// Usage: node .hub-access-guest.mjs list|grant|revoke
import { homedir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(new URL(".", import.meta.url).pathname);
const { configureRuntimeRoot } = await import(`${repoRoot}/packages/hub/dist/runtime-files.js`);
configureRuntimeRoot(resolve(repoRoot, "packages/hub"));
const { createEmbeddedRuntime } = await import(
  `${repoRoot}/packages/hub/dist/db/runtime/internal/embedded.js`
);
const { createDatabase } = await import(`${repoRoot}/packages/hub/dist/db/pg.js`);
const { loadChannelControlPlane } = await import(
  `${repoRoot}/packages/hub/dist/channels/control-plane.js`
);
const { load } = await import("js-yaml");

const DATA_DIR = process.env.CLISBOT_HOME || `${homedir()}/.clisbot-dev`;
const mode = process.argv[2] ?? "list";
if (!["list", "grant", "revoke"].includes(mode)) {
  console.error("usage: node .hub-access-guest.mjs list|grant|revoke");
  process.exit(2);
}

const runtime = await createEmbeddedRuntime(DATA_DIR);
const query = async (sql, params) => (await runtime.runtime.query(sql, params)).rows;

const daemons = await query(
  `select id, organization_id, slug, status from daemons where status = 'active'`,
);
// The configured accounts, read from the active revision's channel files.
const database = createDatabase(runtime.runtime, runtime.locks);
const snapshot = await loadChannelControlPlane(database);
const accounts = [];
for (const file of snapshot.files) {
  let doc;
  try {
    doc = load(file.content);
  } catch {
    continue;
  }
  if (typeof doc?.channel === "string" && typeof doc?.accountId === "string") {
    accounts.push({
      channel: doc.channel,
      accountId: doc.accountId,
      resourceId: `${encodeURIComponent(doc.channel)}/${encodeURIComponent(doc.accountId)}`,
    });
  }
}
for (const account of accounts) console.log(`account ${JSON.stringify(account)}`);
for (const row of daemons) console.log(`daemon ${JSON.stringify(row)}`);
const existing = await query(
  `select id, organization_id, subject_kind, subject_id, resource_kind, resource_id, privileges
     from access_assignments order by created_at`,
);
for (const row of existing) console.log(`assignment ${JSON.stringify(row)}`);

if (mode === "grant") {
  for (const daemon of daemons) {
    await runtime.runtime.query(
      `insert into access_assignments
         (organization_id, subject_kind, subject_id, resource_kind, resource_id, privileges, constraints)
       values ($1, 'guest', 'guest', 'daemon', $2, $3::jsonb, '{}'::jsonb)
       on conflict (organization_id, subject_kind, subject_id, resource_kind, resource_id)
       do update set privileges = excluded.privileges, updated_at = now()`,
      [daemon.organization_id, daemon.id, JSON.stringify(["daemon.connect", "daemon.manage"])],
    );
    console.log(`granted guest daemon.connect+daemon.manage on daemon ${daemon.id}`);
  }
  const organizationId = daemons[0]?.organization_id;
  for (const account of accounts) {
    if (organizationId === undefined) break;
    await runtime.runtime.query(
      `insert into access_assignments
         (organization_id, subject_kind, subject_id, resource_kind, resource_id, privileges, constraints)
       values ($1, 'guest', 'guest', 'channel_account', $2, $3::jsonb, $4::jsonb)
       on conflict (organization_id, subject_kind, subject_id, resource_kind, resource_id)
       do update set privileges = excluded.privileges, constraints = excluded.constraints, updated_at = now()`,
      [
        organizationId,
        account.resourceId,
        JSON.stringify(["channel.use"]),
        JSON.stringify({ conversation: { kind: "all" } }),
      ],
    );
    console.log(`granted guest channel.use on ${account.resourceId}`);
  }
}
if (mode === "revoke") {
  const removed = await query(
    `delete from access_assignments where subject_kind = 'guest' returning id`,
  );
  console.log(`revoked ${removed.length} guest assignment(s)`);
}
await runtime.runtime.close?.();
