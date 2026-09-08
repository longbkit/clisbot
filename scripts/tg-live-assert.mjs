#!/usr/bin/env node
// Telegram live-assertion driver — one command per assertion (mirror of
// slack-live-assert.mjs; see docs/lessons/2026-08-28-live-e2e-speedups.md
// "one assertion script per surface").
//
// Read-back combines the MASTER bot's getUpdates stream with the Hub's
// content-free `relay post completed` event, plus the command branch's own
// lines (`channel inbound answered an approval command` and
// `[telegram/send] telegram outbound send ok … messageId=N`), which is how
// `/help`, `/new` and `/stop` answer — they never produce a relay post.
// Telegram does not reliably
// deliver bot-authored group messages to another bot, so getUpdates alone
// cannot prove outbound. The Hub event distinguishes assistant output from
// progress/tool posts without logging message content or credentials.
// Drained updates are appended to a durable obs log so `check` can re-verify:
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
//   CLISBOT_HOME for hub.log + obs log.
// Prints a single VERDICT line (PASS/FAIL + evidence) as the last line.

import { appendFileSync, readFileSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";

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
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

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

/** Multipart upload for the file-inbound scenario (`sendDocument`). */
async function apiUpload(method, body, filePath) {
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) form.append(key, String(value));
  form.append("document", new Blob([readFileSync(filePath)]), basename(filePath));
  const res = await fetch(`${API}/${method}`, { method: "POST", body: form });
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
    } catch {
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
  const clean = raw.replace(ANSI_ESCAPE, "").split("\n");
  const events = [];
  for (let i = 0; i < clean.length; i++) {
    const line = clean[i];
    if (!/INFO:|WARN:/.test(line)) continue;
    const t = parseLogTime(line);
    if (t === null || t < sinceMs) continue;
    if (
      !/provider event routing completed|bound a thread|bound a channel|bound a conversation|conversation bound to a new agent session|steered an existing session|inbound answered/i.test(
        line,
      )
    )
      continue;
    // Block = INFO line + indented continuation lines (agentId/channel live
    // there). Keep only Telegram-channel events.
    let block = line.replace(/\s+/g, " ").slice(0, 160);
    for (let j = i + 1; j < clean.length && /^\s{2,}\S/.test(clean[j]); j++) {
      block += " " + clean[j].trim();
    }
    if (!/channel: "telegram"|deliveryId: "telegram:/.test(block)) continue;
    events.push({ t: new Date(t).toISOString(), line: block.slice(0, 400) });
  }
  return events;
}

/** The tail of `hub.log`, ANSI-stripped and split into lines. */
function hubLogLines() {
  try {
    const st = statSync(HUB_LOG);
    const size = Math.min(st.size, 5 * 1024 * 1024);
    const buf = Buffer.alloc(size);
    const fd = openSync(HUB_LOG, "r");
    readSync(fd, buf, 0, size, st.size - size);
    closeSync(fd);
    return buf.toString("utf8").replace(ANSI_ESCAPE, "").split("\n");
  } catch {
    return [];
  }
}

/**
 * The vertical's own send lines, for replies that never go through the relay.
 *
 * `/help`, `/new`, `/stop` and the other session commands are answered on the
 * command branch: the Hub logs `channel inbound answered an approval command`
 * and the vertical logs `[telegram/send] telegram outbound send ok … messageId=N`.
 * Neither produces a `relay post completed` event, so a wave-6 `check` reported
 * `no outbound evidence` for replies that were sitting in the group. The
 * command line dates the answer; the send line carries the posted message id.
 */
function commandRepliesSince(sinceMs) {
  const replies = [];
  for (const line of hubLogLines()) {
    const isCommand = /INFO:.*channel inbound answered an approval command/.test(line);
    const isSend = /INFO:.*\[telegram\/send\] telegram outbound send ok/.test(line);
    if (!isCommand && !isSend) continue;
    const t = parseLogTime(line);
    if (t === null || t < sinceMs) continue;
    replies.push({
      t: new Date(t).toISOString(),
      kind: isCommand ? "command" : "send",
      externalMessageId: line.match(/messageId=(\S+)/)?.[1] ?? "",
    });
  }
  return replies;
}

function assistantPostsSince(sinceMs) {
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
  const clean = raw.replace(ANSI_ESCAPE, "").split("\n");
  const posts = [];
  for (let i = 0; i < clean.length; i++) {
    const line = clean[i];
    if (!/INFO:.*relay post completed/.test(line)) continue;
    const t = parseLogTime(line);
    if (t === null || t < sinceMs) continue;
    let block = line;
    for (let j = i + 1; j < clean.length && /^\s{2,}\S/.test(clean[j]); j++) {
      block += ` ${clean[j].trim()}`;
    }
    if (!/channel: "telegram"/.test(block) || !/outputKind: "assistant"/.test(block)) continue;
    posts.push({
      t: new Date(t).toISOString(),
      externalMessageId: block.match(/externalMessageId: "([^"]*)"/)?.[1] ?? "",
    });
  }
  return posts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A "reply" is a chat message the MASTER bot did not author.
function findReply(rows, masterId, masterUsername, expect, sinceMs = 0) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const m = rows[i].msg;
    if ((m.date ?? 0) * 1000 < sinceMs) continue;
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
  let markerMsgId;
  try {
    // `--file <path>` posts the marker as a document caption instead of a
    // plain message, so an inbound-attachment scenario uses the same driver.
    const filePath = opt("file");
    const body = filePath ? { chat_id: CHAT, caption: text } : { chat_id: CHAT, text };
    if (THREAD !== undefined) body.message_thread_id = THREAD;
    const r = filePath
      ? await apiUpload("sendDocument", body, filePath)
      : await api("sendMessage", body);
    markerMsgId = r.message_id;
  } catch (e) {
    console.log(`VERDICT FAIL marker-post-failed: ${e.message}`);
    process.exit(1);
  }
  console.log(
    `[t+0ms] marker posted msg=${markerMsgId}${THREAD !== undefined ? ` thread=${THREAD}` : ""}`,
  );

  const deadline = t0 + TIMEOUT_S * 1000;
  let admission = null;
  let reply = null;
  let relayPost = null;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const events = hubEventsSince(t0);
    if (!admission && events.length > 0) admission = events[events.length - 1];
    if (!reply) {
      const rows = await drainTo(CHAT, undefined, Math.min(5000, deadline - Date.now()));
      reply = findReply(rows, master.id, master.username, expect, t0);
    }
    if (!relayPost) relayPost = assistantPostsSince(t0).at(-1) ?? null;
    if (admission && (reply || relayPost)) break;
  }
  const ok = Boolean(admission && (reply || relayPost));
  console.log(
    `[t+${Math.round((Date.now() - t0) / 1000)}s] hub.log: ${admission ? `${admission.t} ${admission.line}` : "NO admission"}`,
  );
  console.log(
    `[t+${Math.round((Date.now() - t0) / 1000)}s] reply: ${
      reply
        ? `msg=${reply.msg.message_id} date=${reply.msg.date} thread=${reply.msg.message_thread_id ?? "null"} "${(reply.msg.text ?? reply.msg.caption ?? "").slice(0, 120)}"`
        : "NOT FOUND"
    }`,
  );
  if (relayPost) {
    console.log(
      `[relay] assistant posted message=${relayPost.externalMessageId} at=${relayPost.t}`,
    );
  }
  console.log(
    ok
      ? `VERDICT PASS admission=yes outbound=${reply ? `observer:${reply.msg.message_id}` : `relay:${relayPost.externalMessageId}`}`
      : `VERDICT FAIL admission=${admission ? "yes" : "no"} outbound=${reply || relayPost ? "yes" : "no"}`,
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
  const sinceMs = windowSince(sinceHM);
  const match = findReply(rows, master.id, master.username, expect, sinceMs);
  const relayPost = assistantPostsSince(sinceMs).at(-1) ?? null;
  // The command branch answers without a relay post; its own lines are
  // outbound evidence too (wave 6: `/help`, `/new`, `/stop` all replied while
  // this reported "no outbound evidence").
  const commandEntries = commandRepliesSince(sinceMs);
  // Prefer the vertical's own send line: it names the posted message id.
  const commandReply =
    commandEntries.findLast((entry) => entry.kind === "send") ?? commandEntries.at(-1) ?? null;
  const events = hubEventsSince(sinceMs);
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
  if (relayPost) {
    console.log(
      `[check] relay assistant: message=${relayPost.externalMessageId} at=${relayPost.t}`,
    );
  }
  if (commandReply) {
    console.log(
      `[check] command reply: ${commandReply.kind} message=${commandReply.externalMessageId || "n/a"} at=${commandReply.t}`,
    );
  }
  let outbound = null;
  if (match) outbound = `observer:${match.msg.message_id}`;
  else if (relayPost) outbound = `relay:${relayPost.externalMessageId}`;
  else if (commandReply) outbound = `command:${commandReply.externalMessageId || commandReply.t}`;
  console.log(outbound ? `VERDICT PASS outbound=${outbound}` : "VERDICT FAIL no outbound evidence");
  process.exit(outbound ? 0 : 1);
}

function windowSince(sinceHM) {
  const today = new Date();
  today.setHours(Number(sinceHM.slice(0, 2)), Number(sinceHM.slice(3, 5)), 0, 0);
  return today.getTime();
}
