// READ-ONLY inspection of the embedded Hub PGlite (active channel revision).
// Run ONLY during a hub STOP window (data-dir lock released by the downed hub).
// Never writes. Usage: node inspect-revision.mjs
import { PGlite } from "@electric-sql/pglite";

const DATA_DIR = process.env.HUB_DB_DIR || "/home/node/.clisbot-dev";
const db = new PGlite(DATA_DIR);
await db.waitReady;

async function q(sql, params) {
  const res = await db.query(sql, params ?? []);
  return res.rows;
}

const projects = await q(
  `select p.id, p.name, p.active_configuration_revision_id
     from projects p order by p.created_at`,
);
console.log("projects:", JSON.stringify(projects, null, 2));

for (const p of projects) {
  if (!p.active_configuration_revision_id) continue;
  const revs = await q(
    `select id, version, content_hash, source_kind, raw_yaml, source_evidence
       from project_configuration_revisions where id = $1`,
    [p.active_configuration_revision_id],
  );
  for (const r of revs) {
    console.log("\n===== ACTIVE REVISION project=" + p.name + " =====");
    console.log("id:        " + r.id);
    console.log("version:   " + r.version);
    console.log("contentHash: " + r.content_hash);
    let files = [];
    try {
      const ev =
        typeof r.source_evidence === "string" ? JSON.parse(r.source_evidence) : r.source_evidence;
      files = ev?.bundle?.files ?? [];
    } catch (e) {}
    const paths = files.map((f) => f.path);
    console.log("bundle paths: " + JSON.stringify(paths));
    // Policy: approval grants
    const pol = files.find((f) => f.path.endsWith("policy.yml"));
    if (pol) {
      console.log("\n----- .paseo/channels/policy.yml (approval-relevant) -----");
      const lines = pol.content.split("\n");
      // print any line mentioning approval / grants / roles / identity
      lines.forEach((l, i) => {
        if (/approval|grant|role|ops|user|identity|bot\.interact|bot_token|master/i.test(l))
          console.log("  " + (i + 1) + ": " + l);
      });
    } else {
      console.log("NO policy.yml in bundle");
    }
    // Channel routes: agent targets (provider/model)
    for (const f of files) {
      if (/channels\/(slack|telegram)\//.test(f.path) && f.path.endsWith(".yml")) {
        console.log("\n----- " + f.path + " (agent targets) -----");
        f.content.split("\n").forEach((l, i) => {
          if (/agent|provider|model|match|route|sync|binding/i.test(l))
            console.log("  " + (i + 1) + ": " + l);
        });
      }
    }
  }
}
await db.close();
