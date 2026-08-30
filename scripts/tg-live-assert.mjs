#!/usr/bin/env node
// Telegram live-assertion driver — one command per assertion (mirror of
// slack-live-assert.mjs; see docs/lessons/2026-08-28-live-e2e-speedups.md
// "one assertion script per surface").
//
// Read-back is the MASTER bot's getUpdates stream (the master only plays the
// external sender — never the channel host). Drained updates are appended to
// a durable obs log so `check` can re-verify a window after the fact:
//   $CLISBOT_HOME/.tg-observed-updates.jsonl  (one JSON update per line)
//
// Matching is per-observer (F-02): ids are per-observer in this simulated
// Telegram, so the reply match is content + time + authorship, never
// cross-observer ids. A "reply" is a message the MASTER bot did NOT author
// (its own marker rows carry the expected PONG substring — matching them
// would be a false PASS).
//
// Usage:
//   node scripts/tg-live-assert.mjs post --text "<marker addressing @bot>"
//       [--chat <id>] [--thread <message_thread_id>]
//       [--expect "<substring>"] [--timeout <s>]
//   node scripts/tg-live-assert.mjs check --since "HH:MM"
//       [--chat <id>] [--expect "<substring>"] [--drain]
//
// Env (sourced by the calling shell from the repo .env — never printed):
//   TELEGRAM_MASTER_BOT_TOKEN (the test driver), TELEGRAM_DEV_BOT_USERNAME
//   (the bot under test), TELEGRAM_TEST_GROUP_ID / TELEGRAM_TEST_TOPIC_GROUP_ID,
//   CLISBOT_HOME for hub.log + ledger + obs log.
// Prints a single VERDICT line (PASS/FAIL + evidence) as the last line.

import { appendFileSync, readFileSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const mode = args[0];
if (mode !== "post" && mode !== "check") {
  console.error("usage: tg-live-assert.mjs <post|check> --text/--since ...");
  process.exit(2);
}
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const HOME = process.env.CLISBOT_HOME || `${homedir()}/.clisbot-dev`;
const HUB_LOG = `${HOME}/hub.log`;
const LEDGER = `${HOME}/channels/work/state/telegram.sent-messages.json`;
const OBS_LOG = `${HOME}/.tg-observed-updates.jsonl`;
const MASTER_TOKEN = process.env.TELEGRAM_MASTER_BOT_TOKEN;
const DEV_BOT_USERNAME = process.env.TELEGRAM_DEV_BOT_USERNAME;
const DEFAULT_CHAT = process.env.TELEGRAM_TEST_GROUP_ID;
if (!MASTER_TOKEN || !DEV_BOT_USERNAME) {
  console.error("missing env: TELEGRAM_MASTER_BOT_TOKEN / TELEGRAM_DEV_BOT_USERNAME");
  process.exit(2);
}
const CHAT = Number(opt("chat", DEFAULT_CHAT));
if (!CHAT) {
  console.error("no chat: set TELEGRAM_TEST_GROUP_ID or pass --chat");
  process.exit(2);
}
const THREAD = opt("thread") ? Number(opt("thread")) : undefined;
const TIMEOUT_S = Number(opt("timeout", "300"));
const POLL_MS = 3000;

const API = `https://api.telegram.org/bot${MASTER_TOKEN}`;
async function api(method, body = {}) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error(`${method}: ${j.description ?? res.status}`);
  return j.result;
}

async function masterBotId() {
  const me = await api("getMe");
  return { id: me.id, username: me.username };
}

// Drain getUpdates (non-long-poll), append unseen updates to the obs log,
// return the updates visible in this chat. Advances the update offset —
// that is the lane's routine read-back, recorded durably for `check`.
// When `offset` is undefined the Bot API's own stored offset is used (the
// lane's routine drain shape); once any update id is seen, subsequent calls
// in the same drain pin the explicit offset so nothing is re-fetched.
async function drainTo(chatId, offset, maxMs) {
  const out = [];
  let off = offset;
  const start = Date.now();
  for (;;) {
    let batch = [];
    try {
      batch = await api("getUpdates", {
        ...(off !== undefined ? { offset: off } : {}),
        limit: 100,
        timeout: 2,
      });
    } catch (e) {
      // One transient failure should not kill the loop.
      await sleep(2000);
      if (Date.now() - start > maxMs) break;
      continue;
    }
    for (const u of batch) {
      const next = u.update_id + 1;
      off = off === undefined ? next : Math.max(off, next);
      appendFileSync(OBS_LOG, `${JSON.stringify(u)}\n`);
      const msg = u.message ?? u.edited_message;
      if (msg && Number(msg.chat?.id) === chatId) out.push({ updateId: u.update_id, msg });
    }
    if (batch.length < 100) break; // caught up
    if (Date.now() - start > maxMs) break;
  }
  return out;
}

// Rebuild the seen set for `check` (no API): obs log lines in this chat.
function obsFor(chatId, sinceMs) {
  let raw;
  try {
    raw = readFileSync(OBS_LOG, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let u;
    try {
      u = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = u.message ?? u.edited_message;
    if (!msg || Number(msg.chat?.id) !== chatId) continue;
    const t = (msg.date ?? 0) * 1000;
    if (sinceMs > 0 && t < sinceMs) continue;
    out.push({ updateId: u.update_id, msg });
  }
  return out;
}

function parseLogTime(line) {
  const m = line.match(/^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\.\d{3} \+0000\]/);
  if (!m) return null;
  return new Date(`${m[1]}T${m[2]}Z`).getTime();
}

function hubEventsSince(sinceMs) {
  let raw;
  try {
    const st = statSync(HUB_LOG);
    const size = Math.min(st.size, 5 * 1024 * 1024);
    const buf = Buffer.alloc(size);
    const fd = openSync(HUB_LOG, "r");
    readSync(fd, buf, 0, size, st.size - size);
    closeSync(fd);
    raw = buf.toString("utf8");
  } catch {
    return [];
  }
  const clean = raw.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  const events = [];
  for (let i = 0; i < clean.length; i++) {
    const line = clean[i];
    if (!/INFO:|WARN:/.test(line)) continue;
    const t = parseLogTime(line);
    if (t === null || t < sinceMs) continue;
    if (!/bound a thread|bound a channel|steered an existing session|inbound answered/i.test(line))
      continue;
    // Block = INFO line + indented continuation lines (agentId/channel live
    // there). Keep only Telegram-channel events.
    let block = line.replace(/\s+/g, " ").slice(0, 160);
    for (let j = i + 1; j < clean.length && /^\s{2,}\S/.test(clean[j]); j++) {
      block += " " + clean[j].trim();
    }
    if (!/channel: "telegram"/.test(block)) continue;
    events.push({ t: new Date(t).toISOString(), line: block.slice(0, 400) });
  }
  return events;
}

function ledgerEntries() {
  try {
    const d = JSON.parse(readFileSync(LEDGER, "utf8"));
    const arr = Array.isArray(d) ? d : Object.values(d).find(Array.isArray);
    return arr ?? [];
  } catch {
    return [];
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A "reply" is a chat message the MASTER bot did not author.
function findReply(rows, masterId, masterUsername, expect) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const m = rows[i].msg;
    const from = m.from ?? {};
    if (from.id === masterId || from.username === masterUsername) continue;
    if ((m.text ?? m.caption ?? "").includes(expect)) return rows[i];
  }
  return null;
}

if (mode === "post") {
  const text = opt("text");
  if (!text) {
    console.error("post requires --text");
    process.exit(2);
  }
  const expect = opt("expect", "PONG-");
  const master = await masterBotId().catch((e) => {
    console.log(`VERDICT FAIL getMe-failed: ${e.message}`);
    process.exit(1);
  });
  const t0 = Date.now();
  const before = ledgerEntries().length;
  let markerMsgId;
  try {
    const body = { chat_id: CHAT, text };
    if (THREAD !== undefined) body.message_thread_id = THREAD;
    const r = await api("sendMessage", body);
    markerMsgId = r.message_id;
  } catch (e) {
    console.log(`VERDICT FAIL marker-post-failed: ${e.message}`);
    process.exit(1);
  }
  console.log(
    `[t+0ms] marker posted msg=${markerMsgId}${THREAD !== undefined ? ` thread=${THREAD}` : ""}`,
  );

  const deadline = t0 + TIMEOUT_S * 1000;
  let steer = null;
  let reply = null;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const events = hubEventsSince(t0);
    if (!steer && events.length > 0) steer = events[events.length - 1];
    if (!reply) {
      const rows = await drainTo(CHAT, undefined, Math.min(5000, deadline - Date.now()));
      reply = findReply(rows, master.id, master.username, expect);
    }
    if (steer && reply) break;
  }
  const after = ledgerEntries().length;
  const agentId = steer?.line.match(/agentId: "([a-f0-9-]{36})"/)?.[1] ?? null;
  const ok = Boolean(steer && reply && agentId);
  console.log(
    `[t+${Math.round((Date.now() - t0) / 1000)}s] hub.log: ${steer ? `${steer.t} ${steer.line}` : "NO bind/steer"}`,
  );
  console.log(
    `[t+${Math.round((Date.now() - t0) / 1000)}s] reply: ${
      reply
        ? `msg=${reply.msg.message_id} date=${reply.msg.date} thread=${reply.msg.message_thread_id ?? "null"} "${(reply.msg.text ?? reply.msg.caption ?? "").slice(0, 120)}"`
        : "NOT FOUND"
    }`,
  );
  console.log(`[ledger] entries ${before} -> ${after} (+${after - before})`);
  console.log(
    ok
      ? `VERDICT PASS steer=${agentId} replyMsg=${reply.msg.message_id}`
      : `VERDICT FAIL steer=${steer ? "yes" : "no"} reply=${reply ? "yes" : "no"}`,
  );
  process.exit(ok ? 0 : 1);
} else {
  // check: re-verify a past window from the obs log (optionally draining
  // any pending updates into it first).
  const sinceHM = opt("since");
  if (!sinceHM) {
    console.error('check requires --since "HH:MM"');
    process.exit(2);
  }
  const expect = opt("expect", "PONG-");
  const master = await masterBotId().catch((e) => {
    console.log(`VERDICT FAIL getMe-failed: ${e.message}`);
    process.exit(1);
  });
  let rows;
  if (opt("drain")) {
    rows = await drainTo(CHAT, undefined, 8000);
    rows = rows.filter((r) => (r.msg.date ?? 0) * 1000 >= windowSince(sinceHM));
  } else {
    rows = obsFor(CHAT, windowSince(sinceHM));
  }
  const match = findReply(rows, master.id, master.username, expect);
  const events = hubEventsSince(windowSince(sinceHM));
  console.log(
    `[check since ${sinceHM}] hub events: ${events.map((e) => `${e.t} ${e.line.slice(0, 90)}`).join(" | ") || "none"}`,
  );
  console.log(
    `[check] reply: ${
      match
        ? `msg=${match.msg.message_id} date=${match.msg.date} "${(match.msg.text ?? match.msg.caption ?? "").slice(0, 120)}"`
        : "NOT FOUND"
    }`,
  );
  console.log(
    match ? `VERDICT PASS replyMsg=${match.msg.message_id}` : "VERDICT FAIL no reply match",
  );
  process.exit(match ? 0 : 1);
}

function windowSince(sinceHM) {
  const today = new Date();
  today.setHours(Number(sinceHM.slice(0, 2)), Number(sinceHM.slice(3, 5)), 0, 0);
  return today.getTime();
}
