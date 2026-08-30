#!/usr/bin/env node
// Stop-window channel revision writer for the Slack lane-3 P0 live-E2E wave.
//
// Invariant (STOP < WRITE < START): this runs ONLY while the hub is down
// (port 6868 freed, PID zombie) so the PGlite data-dir lock is released. The
// dev daemon (127.0.0.1:6867, ~/.clisbot-dev) is NEVER stopped and stays up,
// so the live agent validator drives it over a plain trusted /ws session.
//
// It derives every revision from the captured v16 baseline (the known-good
// codex@org-floor start state), so C2/H6/baseline are all computed from one
// trusted source, never chained off a drifting active revision:
//   c2        -> slack route += sync { progress:true, finalAnswers:true }
//   c9        -> slack route += sync { subagents:{ finalAnswers:true } }  (C9/D5 subagent relay)
//   h6        -> hub.yml agents += pi-work { provider: pi }; slack route.agent = pi-work
//   h5        -> hub.yml agents += grok-work { provider: grok, model: grok-4.6 }; slack route.agent = grok-work
//   w3        -> wave-3 sweep base: slack AND telegram routes += full sync
//                { progress:true, finalAnswers:true, subagents:{ finalAnswers:true } };
//                hub.yml agents += pi-work + grok-work (defined but unreferenced:
//                routes stay on codex; unused agents are not live-validated)
//   h5w3      -> w3 + slack route.agent = grok-work  (H5 grok re-drive on Slack)
//   h6w3      -> w3 + slack route.agent = pi-work    (H6 pi re-drive on Slack)
//   ibw3      -> w3 + grok-work on BOTH channels' routes + telegram
//                transport.inlineButtons = group  (approval-button live test:
//                grok agent, button cards on both channels; the slack account's
//                baseline already carries inlineButtons: group, so only TG's
//                knob is set)
//   baseline  -> insert the v16 files UNCHANGED (a fresh revision id at v16 content)
//
// Before insert it (1) runs the channel pre-compile guard
// (compileChannelControlPlane) and (2) live-validates every named agent the
// channel routes reference, mirroring the daemon's validateAgentConfiguration
// gate via the on-demand list_provider_models/modes RPCs. Any failure ABORTS
// without writing.
//
// Usage: node .hub-revision-write.mjs c2|c9|h5|h6|w3|h5w3|h6w3|ibw3|baseline
// No daemon/hub is started or stopped by this script — the shell drives those.

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { load, dump } from "js-yaml";
import WebSocket from "ws";
import { createEmbeddedRuntime } from "./packages/hub/dist/db/runtime/internal/embedded.js";
import { createDatabase } from "./packages/hub/dist/db/pg.js";
import {
  ProjectConfigurationStore,
  revisionBundleFiles,
} from "./packages/hub/dist/configuration/store.js";
import { compileHubBundle } from "./packages/hub/dist/config/bundle.js";
import { HUB_RESOURCE_PATH } from "./packages/hub/dist/config/bundle-contract.js";
import { compileChannelControlPlane } from "./packages/hub/dist/channels/config/compile.js";

const DATA_DIR =
  process.env.CLISBOT_HOME || process.env.PASEO_HUB_DATA_DIR || `${homedir()}/.clisbot-dev`;
const BASELINE_FILE = `${DATA_DIR}/.w3-v16-baseline.json`;
const DAEMON_WS = process.env.TRUSTED_CLIENT_URL || "ws://127.0.0.1:6867/ws";
const scenario = process.argv[2];
const t0 = Date.now();
const log = (x) => console.log(`[t+${Date.now() - t0}ms] ${x}`);
const ts = () => new Date().toISOString();

function fail(msg, code = 1) {
  console.error(`\nABORT (${ts()}): ${msg}`);
  process.exit(code);
}

// ---- live agent validator (trusted /ws -> on-demand provider RPCs) ----------
function password() {
  try {
    const raw = readFileSync(`${DATA_DIR}/.daemon-password`, "utf8").trim();
    const eq = raw.indexOf("=");
    return eq > 0 ? raw.slice(eq + 1).trim() : raw;
  } catch {
    return process.env.PASEO_PASSWORD?.trim() || "";
  }
}
function openTrusted() {
  return new Promise((res, rej) => {
    const pw = password();
    const sock = new WebSocket(DAEMON_WS, pw ? [`paseo.bearer.${pw}`] : undefined);
    const timer = setTimeout(() => rej(new Error("daemon /ws connect timeout")), 15000);
    sock.on("open", () => {
      sock.send(
        JSON.stringify({
          type: "hello",
          clientId: `w3-write-${process.pid}`,
          clientType: "cli",
          protocolVersion: 1,
          capabilities: { selective_agent_timeline: true },
        }),
      );
    });
    sock.on("message", (raw) => {
      let f;
      try {
        f = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const m = f.type === "session" ? f.message : f;
      if (m?.type === "status" && m.payload?.status === "server_info") {
        clearTimeout(timer);
        res(sock);
      }
    });
    sock.on("error", (e) => {
      clearTimeout(timer);
      rej(e);
    });
  });
}
function rpc(sock, type, fields = {}, ms = 30000) {
  return new Promise((res, rej) => {
    const rid = randomUUID();
    const timer = setTimeout(() => rej(new Error(`timeout ${type}`)), ms);
    const onMsg = (raw) => {
      let f;
      try {
        f = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const m = f.type === "session" ? f.message : f;
      const r = m?.requestId ?? m?.payload?.requestId;
      if (r !== rid) return;
      clearTimeout(timer);
      sock.off("message", onMsg);
      res(m);
    };
    sock.on("message", onMsg);
    sock.send(JSON.stringify({ type: "session", message: { type, requestId: rid, ...fields } }));
  });
}
// Mirrors provider-snapshot-manager.validateAgentConfiguration: hasProvider ->
// "not configured"; model must be selectable; modeId must exist. No model/mode
// (pi) only requires the provider to be ready (list returns models w/o error).
async function validateAgent(sock, agent) {
  const issues = [];
  const provider = agent.provider;
  let models = [];
  try {
    const r = await rpc(sock, "list_provider_models_request", { provider });
    const p = r.payload ?? {};
    if (p.error) {
      issues.push({ path: ["provider"], message: p.error });
      return { valid: false, issues };
    }
    models = p.models ?? [];
  } catch (e) {
    issues.push({ path: ["provider"], message: `could not list models: ${e.message}` });
    return { valid: false, issues };
  }
  if (agent.model !== undefined) {
    const hit = models.find((m) => m.id === agent.model || m.aliases?.includes(agent.model));
    if (!hit)
      issues.push({
        path: ["model"],
        message: `Model '${agent.model}' is not available for provider '${provider}'`,
      });
  }
  if (agent.mode !== undefined) {
    let modes = [];
    try {
      const r = await rpc(sock, "list_provider_modes_request", { provider });
      modes = (r.payload ?? {}).modes ?? [];
    } catch {
      modes = [];
    }
    if (!modes.some((m) => m.id === agent.mode))
      issues.push({
        path: ["mode"],
        message: `Mode '${agent.mode}' is not available for provider '${provider}'`,
      });
  }
  return issues.length === 0 ? { valid: true } : { valid: false, issues };
}

// ---- bundle transforms (operate on parsed YAML of the v16 baseline) ---------
const filesByPath = (files) => new Map(files.map((f) => [f.path, f.content]));

function transform(files, name) {
  const m = filesByPath(files);
  const slackPath = ".paseo/channels/slack/work.yml";
  const hubPath = HUB_RESOURCE_PATH;
  if (!m.has(slackPath)) fail(`no slack account file in baseline`);
  if (name === "baseline") return files.map((f) => ({ path: f.path, content: m.get(f.path) }));

  const agentRoutes = (doc, label) => {
    if (!Array.isArray(doc.routes)) fail(`${label} account file has no routes[]`);
    const rs = doc.routes.filter((r) => r && r.agent !== undefined);
    if (rs.length === 0) fail(`no ${label} route with an agent target`);
    return rs;
  };

  const slack = load(m.get(slackPath));
  const slackRoutes = agentRoutes(slack, "slack");
  const w3family = name === "w3" || name === "h5w3" || name === "h6w3" || name === "ibw3";

  if (name === "c2") {
    for (const r of slackRoutes) r.sync = { progress: true, finalAnswers: true };
  } else if (name === "c9") {
    // C9/D5 subagent relay: opt the route into relaying subagent (Task tool)
    // final answers. Root sync.* stays at the org floor; only the subagents
    // sub-block is turned on (schema.ts SyncSubagentsSchema, org default all-false).
    for (const r of slackRoutes) r.sync = { subagents: { finalAnswers: true } };
  } else if (name === "h5") {
    // H5 grok (wave-3 re-drive): the grok provider is a CUSTOM ACP provider on
    // the dev daemon — not a built-in id. It was configured there 2026-08-28
    // via set_daemon_config (persisted in ~/.clisbot-dev/config.json
    // agents.providers.grok = { extends:"acp", command:["grok","agent","stdio"] },
    // hot-applied, no restart). list_provider_models(grok) -> grok-4.6, grok-4.5.
    // Pin the model explicitly: an ACP agent without a model rides the provider's
    // own default selection, which is not what the H-chain assertion expects.
    for (const r of slackRoutes) r.agent = "grok-work";
    const hub = load(m.get(hubPath));
    if (!hub.agents || typeof hub.agents !== "object") fail(`hub.yml has no agents map`);
    hub.agents["grok-work"] = { provider: "grok", model: "grok-4.6" };
    m.set(hubPath, dump(hub, { noRefs: true, lineWidth: -1 }));
  } else if (w3family) {
    // Wave-3 sweep base: the FULL sync knob on BOTH channels' routes
    // (progress + finalAnswers + subagents.finalAnswers — C2 + C9/D5 + G-media
    // all ride the sync.finalAnswers-gated postAssistantMessage path, so the
    // sweep needs every knob on, on both verticals). H agents are DEFINED
    // (h5w3/h6w3 reference them; plain w3 leaves routes on codex — defined-but
    // unreferenced agents are not live-validated, see routeAgentTargets).
    // Model pins are box-bound (wave-2 register: no pin -> daemon default 401s).
    const tgPath = ".paseo/channels/telegram/work.yml";
    if (!m.has(tgPath)) fail(`no telegram account file in baseline (w3 family needs it)`);
    const tg = load(m.get(tgPath));
    const tgRoutes = agentRoutes(tg, "telegram");
    for (const r of slackRoutes)
      r.sync = { progress: true, finalAnswers: true, subagents: { finalAnswers: true } };
    for (const r of tgRoutes)
      r.sync = { progress: true, finalAnswers: true, subagents: { finalAnswers: true } };
    const hub = load(m.get(hubPath));
    if (!hub.agents || typeof hub.agents !== "object") fail(`hub.yml has no agents map`);
    hub.agents["pi-work"] = { provider: "pi", model: "llmproxy/qwen3.8-27b" };
    hub.agents["grok-work"] = { provider: "grok", model: "grok-4.6" };
    if (name === "h5w3") for (const r of slackRoutes) r.agent = "grok-work";
    else if (name === "h6w3") for (const r of slackRoutes) r.agent = "pi-work";
    else if (name === "ibw3") {
      // Approval-button live test: grok on BOTH channels (Slack root + thread
      // routes, Telegram group + topic routes) so the exec-gate approval card
      // surfaces on either vertical, and the Telegram inline-button knob ON so
      // the card actually posts with its reply keyboard (the slack account's
      // baseline already carries inlineButtons: group — round-trip preserves
      // it). The callback_query/block_actions tap seams are in dist on both
      // verticals; only a real user click can fire one.
      // ALSO: the operator's own Telegram user id (1276408333, @longbkit) is
      // added to the ops assignment so the operator can drive the verticals
      // directly from their account (the baseline only admitted the slack
      // external user + the master bot; the master bot is a bot and cannot
      // tap cards, so a real user must be on the allowlist for the tap test).
      for (const r of slackRoutes) r.agent = "grok-work";
      for (const r of tgRoutes) r.agent = "grok-work";
      tg.transport = { ...tg.transport, inlineButtons: "group" };
      const policyPath = ".paseo/channels/policy.yml";
      if (!m.has(policyPath)) fail(`no channel policy file in baseline (ibw3 needs it)`);
      const policy = load(m.get(policyPath));
      const ops = (policy.assignments ?? []).find(
        (a) => Array.isArray(a?.roles) && a.roles.includes("ops"),
      );
      if (!ops || !Array.isArray(ops.identities))
        fail(`no ops assignment in policy.yml (ibw3 needs it)`);
      const userIdentity = "telegram:1276408333";
      if (!ops.identities.includes(userIdentity)) ops.identities.push(userIdentity);
      m.set(policyPath, dump(policy, { noRefs: true, lineWidth: -1 }));
    }
    m.set(hubPath, dump(hub, { noRefs: true, lineWidth: -1 }));
    // Dump tg LAST (after the scenario-specific mutations — ibw3 re-points the
    // routes and sets the transport knob): the route objects are mutated in
    // place, so an early dump would capture the pre-mutation content.
    m.set(tgPath, dump(tg, { noRefs: true, lineWidth: -1 }));
  } else {
    fail(`unknown scenario ${name}`);
  }
  m.set(slackPath, dump(slack, { noRefs: true, lineWidth: -1 }));
  return [...m.entries()].map(([path, content]) => ({ path, content }));
}

function preCompileGuard(files) {
  const bundle = compileHubBundle(files);
  const environmentNames = bundle.configuration.environments
    .filter((e) => e.kind === "daemon")
    .map((e) => e.name);
  const workflowNames = bundle.configuration.triggers.map((t) => t.name);
  compileChannelControlPlane({
    files,
    agentNames: Object.keys(bundle.agents),
    environmentNames,
    workflowNames,
  });
  return bundle;
}

// Collect every named agent a channel route references (from hub.yml agents map).
function routeAgentTargets(files, bundle) {
  const m = filesByPath(files);
  const out = new Set();
  for (const [path, content] of m.entries()) {
    if (!/\.paseo\/channels\/(slack|telegram)\/[^/]+\.yml$/.test(path)) continue;
    if (path.endsWith("policy.yml")) continue;
    const doc = load(content);
    for (const r of doc?.routes ?? []) if (r?.agent) out.add(r.agent);
  }
  return [...out].map((name) => ({ name, agent: bundle.agents[name] }));
}

// Print a named file (or several) from a bundle for the log — full content.
function dumpFiles(files, label, predicate) {
  for (const f of files)
    if (!predicate || predicate(f.path)) log(`---- ${label}: ${f.path} ----\n${f.content}`);
}

const main = async () => {
  log(`scenario=${scenario} dataDir=${DATA_DIR}`);
  let baseFiles;
  if (scenario === "c2") {
    // First cycle: capture the live active (v16) as the baseline source.
    const rt = await createEmbeddedRuntime(DATA_DIR);
    const db = createDatabase(rt.runtime, rt.locks);
    const orgs = await db.listOrganizationsForOperator();
    if (orgs.length !== 1) fail(`expected 1 organization, got ${orgs.length}`);
    const project = await db.findProjectBySlugForOrganization(orgs[0].id, "default");
    if (!project) fail(`no "default" project`);
    const active = await db.findActiveProjectConfiguration(project.id);
    if (!active) fail("no active configuration");
    baseFiles = revisionBundleFiles(active);
    log(
      `captured active revision ${active.id} v${active.version} -> ${baseFiles.map((f) => f.path).join(", ")}`,
    );
    writeFileSync(
      BASELINE_FILE,
      JSON.stringify(
        { capturedAt: ts(), activeId: active.id, activeVersion: active.version, files: baseFiles },
        null,
        2,
      ),
    );
    log(`baseline saved -> ${BASELINE_FILE}`);
    dumpFiles(
      baseFiles,
      "BASELINE",
      (p) =>
        p.includes("slack/work.yml") ||
        p.includes("telegram/work.yml") ||
        p.endsWith("policy.yml") ||
        p === HUB_RESOURCE_PATH,
    );
    await db.close();
  } else {
    if (!readFileSync(BASELINE_FILE, "utf8"))
      fail(`no saved baseline ${BASELINE_FILE}; run c2 first`);
    const saved = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
    baseFiles = saved.files;
    log(`loaded saved baseline (from ${saved.activeId} v${saved.activeVersion})`);
  }

  const files = transform(baseFiles, scenario);
  dumpFiles(
    files,
    `TRANSFORMED(${scenario})`,
    (p) =>
      p.includes("slack/work.yml") ||
      ((scenario === "h6" ||
        scenario === "h5" ||
        scenario === "w3" ||
        scenario === "h5w3" ||
        scenario === "h6w3" ||
        scenario === "ibw3") &&
        (p === HUB_RESOURCE_PATH ||
          p.includes("telegram/work.yml") ||
          (scenario === "ibw3" && p.endsWith("policy.yml")))),
  );

  // (1) pre-compile guard.
  const bundle = preCompileGuard(files);
  log(`pre-compile OK (agents: ${Object.keys(bundle.agents).join(", ")})`);

  // (2) live-validate every channel-route agent against the daemon.
  const targets = routeAgentTargets(files, bundle);
  log(
    `route agent targets: ${targets.map((t) => `${t.name}(${t.agent?.provider}${t.agent?.model ? "/" + t.agent.model : ""}${t.agent?.mode ? ":" + t.agent.mode : ""})`).join(", ")}`,
  );
  const sock = await openTrusted();
  const validator = {
    async validateAgentConfiguration(_daemonId, agent) {
      return validateAgent(sock, agent);
    },
  };
  const issues = [];
  for (const t of targets) {
    const res = await validateAgent(sock, t.agent);
    log(
      `validate ${t.name} (${t.agent.provider}): ${res.valid ? "OK" : "ISSUES " + JSON.stringify(res.issues)}`,
    );
    if (!res.valid)
      issues.push(...res.issues.map((i) => `${t.name}.${i.path.join(".")}: ${i.message}`));
  }
  sock.close();
  if (issues.length) fail(`agent validation failed: ${issues.join("; ")}`);

  // insert + activate.
  const rt = await createEmbeddedRuntime(DATA_DIR);
  const db = createDatabase(rt.runtime, rt.locks);
  const orgs = await db.listOrganizationsForOperator();
  if (orgs.length !== 1) fail(`expected 1 organization, got ${orgs.length}`);
  const project = await db.findProjectBySlugForOrganization(orgs[0].id, "default");
  if (!project) fail(`no "default" project`);
  const store = new ProjectConfigurationStore(db, project.id, validator);
  const revision = await store.insertManualBundleRevision({
    files,
    userId: null,
    sourceEvidence: { kind: "manual", userId: null, note: `slack-lane3 ${scenario}`, at: ts() },
  });
  log(`inserted revision ${revision.id} v${revision.version}`);
  const activated = await store.activate(revision.id);
  log(`ACTIVATED ${activated.revision.id} v${activated.revision.version}`);
  console.log(
    `\nRESULT scenario=${scenario} revision=${activated.revision.id} version=v${activated.revision.version}`,
  );
  await db.close();
};

main().catch((e) => fail(e?.stack ?? String(e)));
