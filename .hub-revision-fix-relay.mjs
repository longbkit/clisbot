#!/usr/bin/env node
// Stop-window fix: re-point the Slack account back to the org-floor relay
// path. The active wave-3 revision (v27) carries `defaults.outbound.path:
// tool` in policy.yml (org layer, E4/E6 campaign) — the agent then only
// reaches the user by calling the message tool, and a skipped call means
// "hi" gets no reply. This derives from the LIVE active revision and adds a
// slack-account-level override `defaults.outbound.path: relay`, leaving
// telegram and the org policy untouched. STOP < WRITE < START.

import { readFileSync } from "node:fs";
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
const DAEMON_WS = process.env.TRUSTED_CLIENT_URL || "ws://127.0.0.1:6867/ws";
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
          clientId: `relay-fix-${process.pid}`,
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

// ---- read the live active revision + transform ------------------------------
const filesByPath = (files) => new Map(files.map((f) => [f.path, f.content]));

function transform(files, activeId) {
  const m = filesByPath(files);
  const slackPath = ".paseo/channels/slack/work.yml";
  if (!m.has(slackPath)) fail(`no slack account file in active revision ${activeId}`);
  const slack = load(m.get(slackPath));
  const defaults = slack.defaults ?? {};
  if (defaults.outbound?.path === "relay") {
    log(`slack account already overrides outbound.path: relay — nothing to do`);
    return files;
  }
  defaults.outbound = { ...(defaults.outbound ?? {}), path: "relay" };
  slack.defaults = defaults;
  m.set(slackPath, dump(slack, { noRefs: true, lineWidth: -1 }));
  const policyOutbound = m.has(".paseo/channels/policy.yml")
    ? load(m.get(".paseo/channels/policy.yml")).defaults?.outbound
    : null;
  log(
    `slack account defaults.outbound.path = relay (org policy outbound: ${JSON.stringify(policyOutbound)})`,
  );
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

const main = async () => {
  log(`dataDir=${DATA_DIR}`);
  const rt = await createEmbeddedRuntime(DATA_DIR);
  const db = createDatabase(rt.runtime, rt.locks);
  const orgs = await db.listOrganizationsForOperator();
  if (orgs.length !== 1) fail(`expected 1 organization, got ${orgs.length}`);
  const project = await db.findProjectBySlugForOrganization(orgs[0].id, "default");
  if (!project) fail(`no "default" project`);
  const active = await db.findActiveProjectConfiguration(project.id);
  if (!active) fail("no active configuration");
  const baseFiles = revisionBundleFiles(active);
  log(
    `active revision ${active.id} v${active.version}: ${baseFiles.map((f) => f.path).join(", ")}`,
  );

  const files = transform(baseFiles, active.id);
  for (const f of files)
    if (f.path.includes("slack/work.yml") || f.path.endsWith("policy.yml"))
      log(`---- ${f.path} ----\n${f.content}`);

  const bundle = preCompileGuard(files);
  log(`pre-compile OK (agents: ${Object.keys(bundle.agents).join(", ")})`);

  const targets = routeAgentTargets(files, bundle);
  log(`route agent targets: ${targets.map((t) => t.name).join(", ")}`);
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

  const store = new ProjectConfigurationStore(db, project.id, validator);
  const revision = await store.insertManualBundleRevision({
    files,
    userId: null,
    sourceEvidence: {
      kind: "manual",
      userId: null,
      note: "slack relay-path fix (hi no-reply)",
      at: ts(),
    },
  });
  log(`inserted revision ${revision.id} v${revision.version}`);
  const activated = await store.activate(revision.id);
  log(`ACTIVATED ${activated.revision.id} v${activated.revision.version}`);
  console.log(`\nRESULT revision=${activated.revision.id} version=v${activated.revision.version}`);
  await db.close();
};

main().catch((e) => fail(e?.stack ?? String(e)));
