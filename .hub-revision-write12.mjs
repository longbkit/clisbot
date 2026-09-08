#!/usr/bin/env node
// Slice-12 live-E2E channel revision writer (same shape as
// `.hub-revision-write.mjs`, re-targeted at the current organization-scoped
// channel configuration store: `loadChannelControlPlane` + `deployRevision`,
// not the retired per-project bundle path).
//
// Invariant (STOP < WRITE < START): runs ONLY while the Hub is down — the
// PGlite cluster in $CLISBOT_HOME is locked by the running Hub. The dev daemon
// (127.0.0.1:6867, ~/.clisbot-dev) stays up; never ~/.paseo, never 6767.
//
// Scenarios (each derives from the CURRENT active revision, so they compose):
//   policy   -> add `.paseo/channels/policy.yml`: the two live E2E senders are
//               mapped to Hub users and assigned `admin`, without which
//               `mayTrigger` denies every inbound on a `members` route
//               (policy.ts isConfiguredChannelIdentity). Approval floor:
//               destructive commands prompt, everything else auto-allows, and
//               both transports get `inlineButtons: group` so the approval card
//               carries native buttons.
//   toolpath -> Slack channel+thread routes and the Telegram group route move to
//               `outbound.path: tool` (the Hub-attached `message` tool, the only
//               way an agent can send files / react / edit / pin / poll), and the
//               Telegram topic route turns on `sync.streaming.mode: block`
//               (edit-in-place drafts) while staying on the relay path.
//   relay    -> revert `toolpath`: every route back to the relay outbound path,
//               streaming off.
//
// Usage: node .hub-revision-write12.mjs policy|toolpath|relay
import { homedir } from "node:os";
import { resolve } from "node:path";
import { load, dump } from "js-yaml";

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
const { deployRevision } = await import(
  `${repoRoot}/packages/hub/dist/channels/http/configuration.js`
);

const DATA_DIR = process.env.CLISBOT_HOME || `${homedir()}/.clisbot-dev`;
const scenario = process.argv[2];
const t0 = Date.now();
const log = (x) => console.log(`[t+${Date.now() - t0}ms] ${x}`);
const fail = (m) => {
  console.error(`\nABORT: ${m}`);
  process.exit(1);
};
if (!["policy", "toolpath", "relay"].includes(scenario ?? "")) {
  fail("usage: node .hub-revision-write12.mjs policy|toolpath|relay");
}

// The live senders, by name (never a token): the Slack workspace user behind
// SLACK_MCP_XOXP_TOKEN, the Telegram master bot (TELEGRAM_MASTER_BOT_TOKEN, the
// test driver) and the operator's own Telegram account (button taps).
const SLACK_SENDER = "slack:U8ZTVGJJF";
const TELEGRAM_DRIVER = "telegram:8857655856";
const TELEGRAM_OPERATOR = "telegram:1276408333";

const POLICY = {
  enabled: true,
  channels: { slack: { enabled: true }, telegram: { enabled: true } },
  roles: { user: { grants: ["bot.interact"] }, admin: { grants: ["*"] } },
  users: {
    "long.luong": { name: "Long Luong", identities: [SLACK_SENDER, TELEGRAM_OPERATOR] },
    "e2e-driver": { name: "Slice 12 live driver", identities: [TELEGRAM_DRIVER] },
  },
  assignments: [
    { identities: ["user:long.luong"], roles: ["admin"] },
    { identities: ["user:e2e-driver"], roles: ["admin"] },
  ],
  defaults: {
    // Slack's floor anchor is a channel-root post; the live lane wants the
    // answer threaded under the marker it replies to (and the read-back
    // asserts on `conversations-replies`).
    reply: { anchor: "thread" },
    approval: [
      { match: "command.destructive", mode: "require", initiatorOnly: true },
      { match: "*", mode: "auto-allow" },
    ],
  },
};

const POLICY_PATH = ".paseo/channels/policy.yml";
const SLACK_PATH = ".paseo/channels/slack/personal-assistant.yml";
const TELEGRAM_PATH = ".paseo/channels/telegram/onboarding-telegram.yml";

function routesOf(doc, path) {
  if (!Array.isArray(doc.routes)) fail(`${path} has no routes[]`);
  return doc.routes;
}

function transform(files) {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  // Every scenario re-writes the policy: it is the lane's fixed identity +
  // approval floor, and a partial revision would drop it.
  byPath.set(POLICY_PATH, dump(POLICY, { noRefs: true, lineWidth: -1 }));
  if (scenario === "policy") {
    for (const [path, key] of [
      [SLACK_PATH, "slack"],
      [TELEGRAM_PATH, "telegram"],
    ]) {
      if (!byPath.has(path)) fail(`no ${key} account file`);
      const doc = load(byPath.get(path));
      doc.transport = { ...doc.transport, inlineButtons: "group" };
      byPath.set(path, dump(doc, { noRefs: true, lineWidth: -1 }));
    }
  } else {
    const slack = load(byPath.get(SLACK_PATH) ?? fail("no slack account file"));
    const telegram = load(byPath.get(TELEGRAM_PATH) ?? fail("no telegram account file"));
    const tool = scenario === "toolpath";
    for (const route of routesOf(slack, SLACK_PATH)) {
      if (route.match?.kind === "channel" || route.match?.kind === "thread") {
        if (tool) route.outbound = { path: "tool" };
        else delete route.outbound;
      }
    }
    for (const route of routesOf(telegram, TELEGRAM_PATH)) {
      if (route.match?.kind === "group") {
        if (tool) route.outbound = { path: "tool" };
        else delete route.outbound;
      }
      if (route.match?.kind === "topic") {
        if (tool) route.sync = { ...route.sync, streaming: { mode: "block" } };
        else if (route.sync !== undefined) delete route.sync.streaming;
      }
    }
    byPath.set(SLACK_PATH, dump(slack, { noRefs: true, lineWidth: -1 }));
    byPath.set(TELEGRAM_PATH, dump(telegram, { noRefs: true, lineWidth: -1 }));
  }
  return [...byPath.entries()].map(([path, content]) => ({ path, content }));
}

const runtime = await createEmbeddedRuntime(DATA_DIR);
const database = createDatabase(runtime.runtime, runtime.locks);
const snapshot = await loadChannelControlPlane(database);
log(
  `active revision ${snapshot.revision?.id ?? "none"} v${snapshot.revision?.version ?? 0} (${snapshot.files.length} files)`,
);
const files = transform(snapshot.files);
for (const file of files) log(`---- ${file.path} ----\n${file.content}`);
// deployRevision pre-compiles the hub bundle + the channel control plane and
// only then inserts + activates; a broken candidate aborts without writing.
await deployRevision(database, snapshot, files, {
  expectedRevisionId: snapshot.revision?.id ?? null,
});
const after = await loadChannelControlPlane(database);
console.log(
  `\nRESULT scenario=${scenario} revision=${after.revision?.id} v${after.revision?.version}`,
);
await database.close();
