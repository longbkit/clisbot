// Built-in read-only web demo (W-2 of the web chat channel architecture).
// One self-contained page served by the API channel: session list + live
// SSE stream of run updates and structured run events. Deliberately tiny —
// the full React surface replaces this, on the same endpoints.

export function renderWebDemoPage(botId: string) {
  const encodedBotId = encodeURIComponent(botId);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>clisbot · sessions</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.45 ui-sans-serif, system-ui, sans-serif; background: #0e1116; color: #dce3ea; height: 100vh; display: flex; flex-direction: column; }
  header { padding: 10px 16px; border-bottom: 1px solid #232a33; display: flex; gap: 10px; align-items: center; }
  header b { color: #7cc4ff; }
  header input { flex: 1; max-width: 380px; background: #161b22; color: inherit; border: 1px solid #2b333d; border-radius: 6px; padding: 6px 10px; }
  header button { background: #1f6feb; color: #fff; border: 0; border-radius: 6px; padding: 6px 14px; cursor: pointer; }
  main { flex: 1; display: flex; min-height: 0; }
  #sessions { width: 320px; border-right: 1px solid #232a33; overflow-y: auto; padding: 8px; }
  .session { padding: 8px 10px; border-radius: 8px; cursor: pointer; margin-bottom: 4px; }
  .session:hover { background: #161b22; }
  .session.active { background: #1c2430; }
  .session .key { font-weight: 600; word-break: break-all; }
  .session .meta { color: #8b98a5; font-size: 12px; }
  .state-running { color: #3fb950; } .state-detached { color: #d29922; } .state-idle { color: #8b98a5; }
  #stream { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .entry { border: 1px solid #232a33; border-radius: 10px; padding: 10px 12px; max-width: 900px; }
  .entry .tag { font-size: 11px; color: #8b98a5; margin-bottom: 4px; }
  .entry pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 13px/1.4 ui-monospace, monospace; }
  .entry.update-running { border-color: #2b4a6f; }
  .entry.update-completed { border-color: #1f4a2c; }
  .entry.update-error { border-color: #6f2b2b; }
  .entry.event { background: #12161c; }
  #empty { color: #8b98a5; padding: 24px; }
</style>
</head>
<body>
<header>
  <b>clisbot</b><span>read-only session viewer · bot <code>${botId}</code></span>
  <input id="token" type="password" placeholder="API bearer token (stored locally)" />
  <button id="connect">Load sessions</button>
</header>
<main>
  <div id="sessions"></div>
  <div id="stream"><div id="empty">Enter the bot token, load sessions, then pick one to follow live.</div></div>
</main>
<script>
"use strict";
const botId = ${JSON.stringify(encodedBotId)};
const tokenInput = document.getElementById("token");
const sessionsPane = document.getElementById("sessions");
const streamPane = document.getElementById("stream");
// Deep links: ?token=... prefills auth, ?follow=<sessionKey|first> opens a
// session immediately (shareable read-only view of a live run).
const pageParams = new URLSearchParams(location.search);
tokenInput.value = pageParams.get("token") || localStorage.getItem("clisbot-demo-token") || "";
let autoFollow = pageParams.get("follow");
let eventSource = null;
let activeKey = null;
let liveUpdateCard = null;

function api(path) {
  const token = tokenInput.value.trim();
  localStorage.setItem("clisbot-demo-token", token);
  return "/api/bots/" + botId + path + (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
}

async function loadSessions() {
  const response = await fetch(api("/sessions"));
  if (!response.ok) {
    sessionsPane.innerHTML = '<div class="session">Error ' + response.status + " — check the token</div>";
    return;
  }
  const body = await response.json();
  sessionsPane.innerHTML = "";
  for (const session of body.sessions) {
    const item = document.createElement("div");
    item.className = "session" + (session.sessionKey === activeKey ? " active" : "");
    item.innerHTML =
      '<div class="key">' + escapeHtml(session.sessionKey) + "</div>" +
      '<div class="meta"><span class="state-' + session.runtimeState + '">' + session.runtimeState + "</span>" +
      " · " + escapeHtml(session.agentId) + " · " + new Date(session.updatedAt).toLocaleString() + "</div>";
    item.onclick = () => follow(session.sessionKey);
    sessionsPane.appendChild(item);
  }
  if (!body.sessions.length) {
    sessionsPane.innerHTML = '<div class="session">No sessions yet.</div>';
  }
  if (autoFollow && body.sessions.length) {
    const wanted = autoFollow === "first"
      ? body.sessions[0].sessionKey
      : (body.sessions.find((s) => s.sessionKey === autoFollow) || body.sessions[0]).sessionKey;
    autoFollow = null;
    follow(wanted);
  }
}

function follow(sessionKey) {
  activeKey = sessionKey;
  liveUpdateCard = null;
  streamPane.innerHTML = "";
  if (eventSource) { eventSource.close(); }
  eventSource = new EventSource(api("/sessions/" + encodeURIComponent(sessionKey) + "/events"));
  eventSource.addEventListener("session", (message) => render(JSON.parse(message.data)));
  eventSource.onerror = () => appendCard("event", "stream", "(connection lost — retrying)");
  loadSessions();
}

function render(entry) {
  const payload = entry.payload;
  if (payload.kind === "run-update") {
    const label = "run " + payload.status + (payload.note ? " — " + payload.note : "");
    if (payload.status === "running" && liveUpdateCard) {
      liveUpdateCard.querySelector(".tag").textContent = label;
      liveUpdateCard.querySelector("pre").textContent = payload.snapshot;
    } else {
      liveUpdateCard = appendCard("update-" + payload.status, label, payload.snapshot);
      if (payload.status !== "running") { liveUpdateCard = null; }
    }
    return;
  }
  const event = payload.event;
  if (event.type === "message-delta") { return; } // already visible via run-update snapshots
  appendCard("event", event.type, JSON.stringify(event, null, 2));
}

function appendCard(kind, tag, text) {
  const card = document.createElement("div");
  card.className = "entry " + kind;
  card.innerHTML = '<div class="tag"></div><pre></pre>';
  card.querySelector(".tag").textContent = tag;
  card.querySelector("pre").textContent = text;
  streamPane.appendChild(card);
  streamPane.scrollTop = streamPane.scrollHeight;
  return card;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

document.getElementById("connect").onclick = loadSessions;
if (tokenInput.value) { loadSessions(); }
</script>
</body>
</html>`;
}
