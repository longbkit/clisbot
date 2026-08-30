#!/usr/bin/env node
// Stop-window fix: the live active revision carries `outbound.path: tool`
// (org policy defaults, E4/E6 campaign) — the Slack route then reaches the
// user ONLY through the message tool, and an agent that answers without
// calling it posts nothing. This script derives from the LIVE active
// revision (never the v16 baseline) and sets route-level
// `outbound.path: relay` on every Slack route with an agent target,
// restoring the org-floor relay post. Telegram and the org policy stay
// untouched. STOP < WRITE < START: runs only while the hub is down.

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
          clientId: `slack-relay-${process.pid}`,
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

// ---- transform: slack routes -> org-floor relay path -------------------------
const filesByPath = (files) => new Map(files.map((f) => [f.path, f.content]));

function transform(files) {
  const m = filesByPath(files);
  const slackPath = ".paseo/channels/slack/work.yml";
  if (!m.has(slackPath)) fail("no slack account file in the active revision");
  const slack = load(m.get(slackPath));
  if (!Array.isArray(slack.routes)) fail("slack account file has no routes[]");
  const agentRoutes = slack.routes.filter((r) => r && r.agent !== undefined);
  if (agentRoutes.length === 0) fail("no slack route with an agent target");
  for (const r of agentRoutes) r.outbound = { path: "relay" };
  m.set(slackPath, dump(slack, { noRefs: true, lineWidth: -1 }));
  log(`slack routes re-pointed to outbound.path=relay (${agentRoutes.length} route(s))`);
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
    `active revision ${active.id} v${active.version} -> ${baseFiles.map((f) => f.path).join(", ")}`,
  );

  const files = transform(baseFiles);
  const m = filesByPath(files);
  if (m.has(".paseo/channels/policy.yml"))
    log(`---- policy.yml (untouched) ----\n${m.get(".paseo/channels/policy.yml")}`);
  log(
    `---- .paseo/channels/slack/work.yml (transformed) ----\n${m.get(".paseo/channels/slack/work.yml")}`,
  );

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
      note: "slack routes back to org-floor relay path (hi no-reply fix)",
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
