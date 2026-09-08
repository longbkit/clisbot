#!/usr/bin/env node
// Slack live-assertion driver — one command per assertion (see
// docs/lessons/2026-08-28-live-e2e-speedups.md "one assertion script per
// surface"). Replaces the ~10 manual tool calls per live assertion with:
// post marker (user cred, mention-shaped text as passed) -> poll hub.log for
// bind/steer since t0 -> read the channel/thread back
// and match on content (per-observer ids, F-02 — never cross-observer ids)
// -> print PASS/FAIL + the evidence lines.
//
// Usage:
//   node scripts/slack-live-assert.mjs post --text "<marker with trailing mention>"
//       [--thread-ts <ts>] [--expect "<regex-safe substring>"] [--timeout <s>]
//   node scripts/slack-live-assert.mjs check --since "HH:MM"
//       [--thread-ts <ts>] [--expect "<substring>"]
//
// Env: SLACK_TEST_CHANNEL (or --channel), CLISBOT_HOME for hub.log + ledger.
// Prints a single VERDICT line (PASS/FAIL + evidence) as the last line.

import { execFileSync } from "node:child_process";
import { openSync, readSync, closeSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

// Run as a CLI, or imported by scripts/slack-live-assert.test.mjs for the
// read-back parser. Importing must never argv-check or exit.
const IS_ENTRYPOINT = process.argv[1] === fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const mode = args[0];
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const HOME = process.env.CLISBOT_HOME || `${homedir()}/.clisbot-dev`;
const HUB_LOG = `${HOME}/hub.log`;
const CHANNEL = opt("channel", process.env.SLACK_TEST_CHANNEL);
const TIMEOUT_S = Number(opt("timeout", "300"));
const POLL_MS = 3000;
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * Parse slack-cli's CSV (header + rows, RFC 4180 quoting) into row objects.
 *
 * The record separator is a newline OUTSIDE quotes only. A multi-line Slack
 * message is one CSV field carrying its own `\n`s, so splitting the output on
 * `\n` first — which this did until wave 5b — shreds one message into several
 * rows: the identity check then sees a fragment row with no `UserID` and
 * reports `identity-mismatch` against the marker's own text. Scan the whole
 * output once and let the quote state decide where a row ends.
 *
 * `--output json` is not a way out: the MCP tool itself returns CSV, so `json`
 * and `raw` just wrap the same text.
 */
export function parseSlackCsv(out) {
  const rows = [];
  let fields = [];
  let cur = "";
  let inQ = false;
  const endField = () => {
    fields.push(cur);
    cur = "";
  };
  const endRow = () => {
    endField();
    if (!(fields.length === 1 && fields[0] === "")) rows.push(fields);
    fields = [];
  };
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (c === '"') {
      if (inQ && out[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (c === "," && !inQ) {
      endField();
    } else if (c === "\n" && !inQ) {
      endRow();
    } else if (c === "\r" && !inQ) {
      // swallow CRLF
    } else cur += c;
  }
  endRow();
  if (rows.length < 2) return [];
  const header = rows[0];
  // Only the FIELD is trimmed, never the row: a message body keeps its
  // newlines so `--expect` can match text that spans lines.
  return rows
    .slice(1)
    .map((row) => Object.fromEntries(header.map((h, i) => [h, (row[i] ?? "").trim()])));
}

function slackCli(flag, ...argv) {
  return parseSlackCsv(
    execFileSync("slack-cli", [flag, ...argv], { encoding: "utf8", timeout: 60_000 }),
  );
}

function parseLogTime(line) {
  // "[2026-08-28 00:39:48.381 +0000] INFO: ..." -> ms epoch
  const m = line.match(/^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\.\d{3} \+0000\]/);
  if (!m) return null;
  return new Date(`${m[1]}T${m[2]}Z`).getTime();
}

function hubEventsSince(sinceMs) {
  // Read the whole log (bounded in practice; tail-friendly fallback below).
  let raw;
  try {
    const st = statSync(HUB_LOG);
    const size = Math.min(st.size, 5 * 1024 * 1024); // last 5 MB is plenty
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
    // Capture the block: the INFO line plus its indented continuation lines
    // (agentId/channel/dispatched live there, not on the INFO line itself).
    let block = line.replace(/\s+/g, " ").slice(0, 160);
    for (let j = i + 1; j < clean.length && /^\s{2,}\S/.test(clean[j]); j++) {
      block += " " + clean[j].trim();
    }
    if (/provider event routing completed/i.test(line) && !/deliveryId: "slack:/.test(block))
      continue;
    events.push({ t: new Date(t).toISOString(), line: block.slice(0, 400) });
  }
  return events;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `chat.postMessage` with the user credential; the field is `channel`, singular. */
async function postWithUserToken(text, threadTs, cliError) {
  const token = process.env.SLACK_MCP_XOXP_TOKEN;
  if (!token) {
    console.log(`VERDICT FAIL marker-post-failed: ${cliError.message}`);
    process.exit(1);
  }
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ channel: CHANNEL, text, ...(threadTs ? { thread_ts: threadTs } : {}) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!body.ok) {
    console.log(
      `VERDICT FAIL marker-post-failed: slack-cli ${cliError.message}; web api ${body.error ?? response.status}`,
    );
    process.exit(1);
  }
  console.log(
    "[post] slack-cli write unavailable; posted with the user credential over chat.postMessage",
  );
  return body.ts;
}

function readBack(threadTs) {
  const flag = threadTs ? "conversations-replies" : "conversations-history";
  const argv = ["--channel-id", CHANNEL, "--limit", "15"];
  if (threadTs) argv.push("--thread-ts", threadTs);
  try {
    return slackCli(flag, ...argv);
  } catch (e) {
    return [{ Text: `READBACK-ERROR: ${e.message}` }];
  }
}

/** The bot under test, from `auth.test`. The token is never printed. */
async function botIdentity() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.log("VERDICT FAIL identity-unverifiable: SLACK_BOT_TOKEN is not set");
    process.exit(2);
  }
  const response = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!body.ok) {
    console.log(`VERDICT FAIL identity-unverifiable: auth.test ${body.error ?? response.status}`);
    process.exit(2);
  }
  return { userId: body.user_id, botId: body.bot_id };
}

// A "reply" is a row the MARKER POSTER did not author: markers embed the
// expected PONG string, so matching the marker row (or any earlier marker)
// would be a false PASS. Find the poster by matching the posted text in the
// read-back, then require a different UserID.
//
// AND the author must be the bot under test. The channel workspace also
// carries a user credential and `slack-cli`, so an agent asked to post, react
// or upload can do it under ANOTHER identity and look like a pass — wave 4
// scored Slack file-out PASS on messages authored by a different app
// ("vaiclaude"). A content match under a foreign identity is a FAIL, reported
// with the identity that actually posted.
function findMatch(rows, expect, postedText, botUserId) {
  let posterId;
  if (postedText !== undefined) {
    for (const r of rows) {
      if ((r.Text ?? "") === postedText) {
        posterId = r.UserID;
        break;
      }
    }
  }
  let mismatch = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.UserID !== undefined && posterId !== undefined && r.UserID === posterId) continue;
    if (!(r.Text ?? "").includes(expect)) continue;
    if (botUserId !== undefined && r.UserID !== botUserId) {
      mismatch ??= r;
      continue;
    }
    return { row: r, mismatch: null };
  }
  return { row: null, mismatch };
}

/** Author + attachment evidence for the tail of a conversation. */
function authorTable(rows, botUserId) {
  return rows
    .slice(-10)
    .map(
      (r) =>
        `${r.Time ?? "?"} ts=${r.MsgID ?? "?"} user=${r.UserID ?? "?"}${
          r.UserID === botUserId ? "(bot-under-test)" : ""
        } files=${r.FileCount ?? "0"} "${(r.Text ?? "").replace(/\s+/g, " ").slice(0, 70)}"`,
    )
    .join("\n  ");
}

if (!IS_ENTRYPOINT) {
  // Imported for tests: exports only, no argv handling.
} else if (mode !== "post" && mode !== "check") {
  console.error("usage: slack-live-assert.mjs <post|check> --text/--since ...");
  process.exit(2);
} else if (!CHANNEL) {
  console.error("no channel: set SLACK_TEST_CHANNEL or pass --channel");
  process.exit(2);
} else if (mode === "post") {
  const text = opt("text");
  if (!text) {
    console.error("post requires --text");
    process.exit(2);
  }
  const threadTs = opt("thread-ts");
  const expect = opt("expect", "PONG-");
  const bot = await botIdentity();
  let identityMismatch = null;
  let lastRows = [];
  const t0 = Date.now();
  const argv = ["--channel-id", CHANNEL, "--text", text];
  if (threadTs) argv.push("--thread-ts", threadTs);
  let markerTs;
  try {
    // conversations-add-message prints plain text, not CSV:
    // "Successfully posted message to channel C07U0LDK6ER (ts=1787878626.847089)"
    const out = execFileSync("slack-cli", ["conversations-add-message", ...argv], {
      encoding: "utf8",
      timeout: 60_000,
    });
    markerTs = out.match(/ts=([0-9.]+)/)?.[1];
    if (!markerTs) throw new Error(`no ts in output: ${out.slice(0, 120)}`);
  } catch (e) {
    // The installed slack-cli intermittently reports `tool
    // 'conversations_add_message' not found`. CLAUDE.md's fallback: post
    // through the Web API with the same USER credential slack-cli itself uses
    // (SLACK_MCP_XOXP_TOKEN) — never SLACK_BOT_TOKEN, which is the bot under
    // test and cannot drive its own inbound. Read-back stays on slack-cli.
    markerTs = await postWithUserToken(text, threadTs, e);
  }
  console.log(`[t+0ms] marker posted ts=${markerTs}${threadTs ? ` thread=${threadTs}` : ""}`);

  const deadline = t0 + TIMEOUT_S * 1000;
  let admission = null;
  let reply = null;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const events = hubEventsSince(t0);
    if (!admission && events.length > 0) admission = events[events.length - 1];
    if (!reply) {
      // A root marker becomes the thread root for the reply. Reading channel
      // history alone cannot see that threaded response.
      const rows = readBack(threadTs ?? markerTs);
      const found = findMatch(rows, expect, text, bot.userId);
      reply = found.row;
      identityMismatch = found.mismatch;
      lastRows = rows;
    }
    if (admission && reply) break;
  }
  const ok = Boolean(admission && reply);
  console.log(
    `[t+${Math.round((Date.now() - t0) / 1000)}s] hub.log: ${admission ? `${admission.t} ${admission.line}` : "NO admission"}`,
  );
  console.log(
    `[t+${Math.round((Date.now() - t0) / 1000)}s] reply: ${
      reply ? `${reply.Time} ts=${reply.MsgID} "${(reply.Text ?? "").slice(0, 120)}"` : "NOT FOUND"
    }`,
  );
  console.log(`[authors] bot-under-test=${bot.userId}\n  ${authorTable(lastRows, bot.userId)}`);
  if (identityMismatch !== null) {
    console.log(
      `VERDICT FAIL identity-mismatch: ts=${identityMismatch.MsgID} was posted by ${identityMismatch.UserID}, not the bot under test ${bot.userId}`,
    );
    process.exit(1);
  }
  console.log(
    ok
      ? `VERDICT PASS admission=yes replyTs=${reply.MsgID} author=${reply.UserID}`
      : `VERDICT FAIL admission=${admission ? "yes" : "no"} reply=${reply ? "yes" : "no"}`,
  );
  process.exit(ok ? 0 : 1);
} else {
  // check: re-verify a past window without posting.
  const sinceHM = opt("since");
  if (!sinceHM) {
    console.error('check requires --since "HH:MM"');
    process.exit(2);
  }
  const threadTs = opt("thread-ts");
  const expect = opt("expect", "PONG-");
  const bot = await botIdentity();
  const today = new Date();
  today.setHours(Number(sinceHM.slice(0, 2)), Number(sinceHM.slice(3, 5)), 0, 0);
  const rows = readBack(threadTs);
  const { row: match, mismatch } = findMatch(rows, expect, undefined, bot.userId);
  const events = hubEventsSince(today.getTime());
  console.log(
    `[check since ${sinceHM}] hub events: ${events.map((e) => `${e.t} ${e.line.slice(0, 90)}`).join(" | ") || "none"}`,
  );
  console.log(`[authors] bot-under-test=${bot.userId}\n  ${authorTable(rows, bot.userId)}`);
  console.log(`[check] reply: ${match ? `${match.Time} ts=${match.MsgID}` : "NOT FOUND"}`);
  if (mismatch !== null) {
    console.log(
      `VERDICT FAIL identity-mismatch: ts=${mismatch.MsgID} was posted by ${mismatch.UserID}, not the bot under test ${bot.userId}`,
    );
    process.exit(1);
  }
  console.log(
    match
      ? `VERDICT PASS replyTs=${match.MsgID} author=${match.UserID}`
      : "VERDICT FAIL no reply match",
  );
  process.exit(match ? 0 : 1);
}
