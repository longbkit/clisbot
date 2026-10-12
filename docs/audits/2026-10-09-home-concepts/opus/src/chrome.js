/* oxlint-disable no-nested-ternary, complexity -- prototype view templates read as one expression per state. */
/* Product chrome and shared Home parts: sidebar, header, composer, pickers, sheets, setup. */
const { icon: I, esc: E } = H;
const U = (H.ui = {});

// ---------- Small parts ----------
U.statusPill = (s) => {
  const h = H.host(s.hostId);
  if (h && h.status === "offline")
    return `<span class="pill">${I("offline", "sm")} Host offline</span>`;
  return (
    {
      needs: '<span class="pill warn"><span class="dot warn"></span>Needs you</span>',
      running: '<span class="pill run"><span class="dot run"></span>Running</span>',
      failed: '<span class="pill danger">Failed</span>',
    }[s.status] || ""
  );
};
U.who = (s) =>
  s.kind === "chat"
    ? `<span class="ri" title="Chat">${E(H.bot(s.botId)?.initials || "B")}</span>`
    : `<span class="ri" title="Agent session">${H.pv(s.provider)}</span>`;
U.meta = (s) => {
  const p = H.project(s.projectId);
  const h = H.host(s.hostId);
  const where = p?.botHome ? "" : p?.scratch ? "Quick chat · " : `${E(p?.name || "")} · `;
  return `${where}${E(h ? H.hostLabel(h) : "")} · ${E(H.sessionWho(s))}`;
};
U.sessionRow = (s, opts = {}) => `
  <button class="row ${H.S.recentIds.includes(s.id) ? "new" : ""}" data-a="open-session" data-id="${s.id}">
    ${U.who(s)}
    <span class="grow"><span class="rt ell" style="display:block">${E(s.title)}</span>
      <span class="rm ell" style="display:block">${opts.preview ? `${E(s.preview)} · ` : ""}${U.meta(s)}</span></span>
    <span class="rr">${U.statusPill(s)}<span>${s.status === "running" ? "" : H.ago(s.ago)}</span></span>
  </button>`;
U.schedRow = (k) => {
  const h = H.host(k.hostId);
  const off = h && h.status !== "online";
  return `<button class="row" data-a="open-schedule" data-id="${k.id}">
    <span class="ri">${I(k.kind === "Heartbeat" ? "pulse" : "automation")}</span>
    <span class="grow"><span class="rt ell" style="display:block">${E(k.name)}</span>
      <span class="rm ell" style="display:block">${E(k.kind)} · ${E(k.target)} · ${E(h ? H.hostLabel(h) : "")}</span></span>
    <span class="rr">${k.paused ? '<span class="pill">Paused</span>' : off ? '<span class="pill warn">Host offline</span>' : `<span>${E(k.day === "Today" ? k.at : `${k.day} ${k.at}`)}</span>`}
      <span>${k.paused ? E(k.day) : E(H.inText(k.inMin))}</span></span>
  </button>`;
};
U.attnActions = (a) =>
  ({
    needs: `<button class="btn sm solid" data-a="approve" data-id="${a.s?.id}">Approve</button><button class="btn sm" data-a="open-session" data-id="${a.s?.id}">Open</button>`,
    failed: `<button class="btn sm" data-a="retry" data-id="${a.s?.id}">${I("refresh", "sm")} Retry</button><button class="btn sm ghost" data-a="open-session" data-id="${a.s?.id}">Open</button>`,
    "run-failed": `<button class="btn sm" data-a="open-schedule" data-id="${a.k?.id}">Open run</button>`,
    offline: `<button class="btn sm" data-a="reconnect" data-id="${a.h?.id}">${I("refresh", "sm")} Reconnect</button>`,
  })[a.kind];
U.attnIcon = (a) =>
  ({
    needs: '<span class="dot warn"></span>',
    failed: '<span class="dot danger"></span>',
    "run-failed": '<span class="dot danger"></span>',
    offline: I("offline", "sm"),
  })[a.kind];

// ---------- Context: Host › Project, plus why it was chosen ----------
U.why = (ctx) => {
  const S = H.S;
  const r = ctx.reason;
  const blocked = {
    starting: "Starting on this Mac…",
    probing: "Looking for Clisbot on this computer…",
    "web-missing": "Clisbot isn't running on this computer",
    "web-blocked": "Blocked by the browser",
    "mobile-pair": "Connect a computer to start",
    "all-offline": "Can't reach your computers",
  }[ctx.blocker?.kind];
  if (blocked) return blocked;
  if (r === "bot") return "Bot's own project";
  if (r === "picked") return "Chosen for this draft";
  if (r === "last") return `Last used ${H.ago(ctx.project?.usedAgo ?? 0)} ago`;
  if (r === "first")
    return H.isLocal(ctx.host)
      ? S.device === "web"
        ? "Found on this computer"
        : "Runs on this computer"
      : "Your connected computer";
  if (r === "host-offline") return `${E(ctx.notice?.from?.name || "Last host")} is offline`;
  if (r === "project-gone") return "Last project was removed";
  return "";
};
U.hostChip = (ctx, cls = "ctx-btn") => {
  const h = ctx.host;
  if (!h) {
    const web = H.S.device === "web";
    return `<button class="${cls}" data-a="pop" data-pop="host" data-anchor="host">${I(web ? "monitor" : "server")}<span class="ell">${web ? "This computer" : "No computer yet"}</span><span class="dot ${web ? "warn" : "off"}"></span>${I("down", "sm")}</button>`;
  }
  const st = h.status === "online" ? "ok" : h.status === "offline" ? "off" : "warn";
  const locked = ctx.reason === "bot";
  return `<button class="${cls}" data-a="${locked ? "pop" : "pop"}" data-pop="host" data-anchor="host" title="${E(H.hostVia(h))}">
    ${I(H.hostIcon(h))}<span class="ell">${E(H.hostLabel(h))}</span><span class="dot ${st}"></span>${I("down", "sm")}</button>`;
};
U.projectChip = (ctx, cls = "ctx-btn") => {
  if (ctx.reason === "bot")
    return `<span class="${cls} locked">${I("bot")}<span class="ell">${E(ctx.project?.name)}</span></span>`;
  const label = ctx.project
    ? E(ctx.project.name)
    : ctx.target.kind === "starter"
      ? "Personal assistant <span class=kind>· new</span>"
      : "Choose project";
  return `<button class="${cls}" data-a="pop" data-pop="project" data-anchor="project" ${ctx.host ? "" : "disabled"}>
    ${I(ctx.project ? "folder" : ctx.target.kind === "starter" ? "spark" : "folder")}<span class="ell">${label}</span>${I("down", "sm")}</button>`;
};
U.ctxLine = (ctx, opts = {}) => `
  <div class="ctx-line">${opts.label ? `<span class="quiet small">${opts.label}</span>` : ""}
    ${U.hostChip(ctx)}<span class="ctx-sep">›</span>${U.projectChip(ctx)}
    ${opts.why === false ? "" : `<span class="quiet small" style="margin-left:4px">${U.why(ctx)}</span>`}
    ${opts.remote === false ? "" : `<button class="btn ghost sm" style="margin-left:auto" data-a="sheet" data-sheet="pair">${I("plus", "sm")} Connect a computer</button>`}
  </div>`;

// ---------- Composer ----------
U.targetChip = (ctx) => {
  const t = ctx.target;
  if (t.kind === "bot") {
    const b = H.bot(t.botId);
    return `<button class="c-chip" data-a="pop" data-pop="target" data-anchor="target"><span class="badge pill" style="padding:0 5px">${E(b.initials)}</span>${E(b.name)}${I("down", "sm")}</button>`;
  }
  const p = H.providers[t.provider];
  const label = t.kind === "starter" ? `${p.name} · ${p.model}` : `${p.model}`;
  return `<button class="c-chip" data-a="pop" data-pop="target" data-anchor="target" title="${E(p.name)}">${H.pv(t.provider)}${E(label)}${I("down", "sm")}</button>`;
};
U.composer = (ctx, opts = {}) => {
  const S = H.S;
  const blocked = !ctx.canSend;
  const ph =
    opts.placeholder ||
    (H.compact
      ? ctx.target.kind === "bot"
        ? `Message ${H.bot(ctx.target.botId).name}…`
        : "Message…"
      : ctx.target.kind === "bot"
        ? `Message ${H.bot(ctx.target.botId).name}…`
        : ctx.target.kind === "starter"
          ? "Ask anything, or describe what you want to build…"
          : "Message the agent, tag @files, or use /commands and /skills");
  return `<div class="composer ${blocked ? "blocked" : ""}">
    <textarea id="draft" rows="${opts.rows || 2}" placeholder="${E(ph)}" aria-label="Message">${E(S.draft)}</textarea>
    <div class="c-bar"><div class="c-chips">
      <button class="c-chip" data-a="attach" title="Attach files">${I("plus")}</button>
      ${opts.ctxInside ? `${U.hostChip(ctx, "c-chip ctx")}${U.projectChip(ctx, "c-chip")}` : ""}
      ${U.targetChip(ctx)}
      ${
        ctx.target.kind === "bot"
          ? ""
          : `<button class="c-chip" data-a="pop" data-pop="thinking" data-anchor="thinking">${I("brain")}${E(S.thinking || "High")}${I("down", "sm")}</button>
      <button class="c-chip" data-a="pop" data-pop="perm" data-anchor="perm">${I("shield")}${E(S.perm || "Default permissions")}${I("down", "sm")}</button>`
      }
      </div>
      <button class="c-chip" data-a="mic" title="Dictate">${I("mic")}</button>
      <button class="c-send" data-a="send" id="send" title="Send (Enter)" ${blocked || !S.draft.trim() ? "disabled" : ""}>${I("up")}</button>
    </div></div>`;
};
U.notice = (ctx) => {
  const n = ctx.notice;
  if (!n)
    return ctx.target.swapped
      ? `<div class="notice info">${I("info")}<div>${E(H.providers[H.S.memory.last?.target?.provider]?.name || "That agent")} isn't ready on ${E(H.hostLabel(ctx.host))}, so this uses ${E(H.providers[ctx.target.provider].name)}.</div></div>`
      : "";
  if (n.kind === "host-offline")
    return `<div class="notice warn">${I("offline")}<div class="grow">
      <b>${E(n.from?.name)} is offline.</b> New messages go to <b>${E(H.hostLabel(n.to))} › ${E(ctx.project?.name || "—")}</b> instead. Your draft is kept; sessions on ${E(n.from?.name)} stay there.
      <div class="acts"><button class="btn sm" data-a="pop" data-pop="host" data-anchor="host">Change</button><button class="btn sm ghost" data-a="reconnect" data-id="${n.from?.id}">${I("refresh", "sm")} Reconnect ${E(n.from?.name)}</button></div></div>
      <button class="x" data-a="dismiss" data-id="host-offline" title="Dismiss">${I("x", "sm")}</button></div>`;
  return `<div class="notice warn">${I("folder")}<div class="grow"><b>${E(n.from)}</b> is no longer on ${E(H.hostLabel(ctx.host))}. New messages go to <b>${E(n.to?.name || "—")}</b>.
      <div class="acts"><button class="btn sm" data-a="pop" data-pop="project" data-anchor="project">Change project</button></div></div>
      <button class="x" data-a="dismiss" data-id="project-gone" title="Dismiss">${I("x", "sm")}</button></div>`;
};

// ---------- Setup: what blocks sending, and the way through ----------
const remoteFoot = (text = "Agents can also run on another computer or server.") =>
  `<div class="setup-foot">${I("server", "sm")}<span class="grow">${text}</span><button class="btn sm" data-a="sheet" data-sheet="pair">Connect a computer</button></div>`;
U.setup = (ctx) => {
  const b = ctx.blocker;
  if (!b) return "";
  const S = H.S;
  if (b.kind === "starting")
    return `<div class="notice info">${I("loader", "spin")}<div class="grow"><b>Starting Clisbot on this Mac…</b> You can type now; send turns on when it's ready.</div></div>`;
  if (b.kind === "probing")
    return `<div class="notice info">${I("loader", "spin")}<div class="grow"><b>Looking for Clisbot on this computer…</b><div class="quiet small">Checking localhost:6767</div></div><button class="btn sm ghost" data-a="sheet" data-sheet="pair">Use another computer</button></div>`;
  if (b.kind === "web-missing")
    return `<div class="setup"><div class="setup-h"><span class="glyph">${I("monitor", "lg")}</span><div><h3>Start Clisbot on this computer</h3><p>The web app talks to Clisbot running on your computer. Your code stays there.</p></div></div>
    <div class="setup-steps">
      <div class="step now"><span class="n">1</span><div class="grow"><div class="st">Open the Clisbot desktop app</div><div class="sd">It starts Clisbot in the background. No terminal needed.</div>
        <div class="sa"><button class="btn sm solid" data-a="open-desktop">${I("external", "sm")} Open Clisbot</button><button class="btn sm ghost" data-a="download">Download</button></div></div></div>
      <div class="step"><span class="n">2</span><div class="grow"><div class="st">Or start it from a terminal</div>
        <div class="sa" style="width:100%"><div class="cmd grow"><span>npm install -g @clisbot/cli && clisbot</span><button class="btn sm ghost" data-a="copy">${I("copy", "sm")}</button></div></div></div></div>
      <div class="step"><span class="n">3</span><div class="grow"><div class="st">Then check again</div><div class="sa"><button class="btn sm" data-a="probe">${I("refresh", "sm")} Look again</button></div></div></div>
    </div>${remoteFoot("Clisbot already runs on another computer or a server?")}</div>`;
  if (b.kind === "web-blocked")
    return `<div class="setup"><div class="setup-h"><span class="glyph">${I("lock", "lg")}</span><div><h3>Your browser blocked this computer</h3><p>Clisbot is running here, but the browser needs your permission to reach it.</p></div></div>
    <div class="setup-steps">
      <div class="step now"><span class="n">1</span><div class="grow"><div class="st">Click the site settings icon in the address bar</div><div class="sd">Set <b>Local network access</b> to <b>Allow</b>.</div></div></div>
      <div class="step"><span class="n">2</span><div class="grow"><div class="st">Check again</div><div class="sa"><button class="btn sm solid" data-a="probe">${I("refresh", "sm")} Look again</button></div></div></div>
    </div>${remoteFoot("Prefer not to? Pair this browser with the computer instead.")}</div>`;
  if (b.kind === "mobile-pair")
    return `<div class="setup"><div class="setup-h"><span class="glyph">${I("monitor", "lg")}</span><div><h3>Connect your computer</h3><p>Agents run on your computer. This phone sends messages and shows what they do.</p></div></div>
    <div class="setup-steps">
      <div class="step"><span class="n">1</span><div class="grow"><div class="st">Open Clisbot on your computer</div><div class="sd">Desktop app, or <code>clisbot</code> on a server.</div></div></div>
      <div class="step"><span class="n">2</span><div class="grow"><div class="st">Settings → your host → Pair Device</div><div class="sd">It shows a QR code and a link.</div></div></div>
      <div class="step now"><span class="n">3</span><div class="grow"><div class="st">Scan it here</div><div class="sa"><button class="btn solid" data-a="sheet" data-sheet="pair" data-method="qr">${I("qr", "sm")} Scan QR code</button><button class="btn" data-a="sheet" data-sheet="pair" data-method="link">${I("link", "sm")} Paste link</button></div></div></div>
    </div><div class="setup-foot">${I("lock", "sm")}<span>End-to-end encrypted. Your code never leaves your computer.</span></div></div>`;
  if (b.kind === "providers") {
    const h = b.host;
    const how = {
      claude: ["Not signed in", "Run <code>claude</code> once in a terminal and sign in"],
      codex: ["Not installed", "<code>npm install -g @openai/codex</code>"],
      opencode: ["Not installed", "See opencode.ai"],
      copilot: ["Not installed", "<code>gh extension install github/gh-copilot</code>"],
    };
    return `<div class="setup"><div class="setup-h"><span class="glyph">${I("terminal", "lg")}</span><div><h3>No agent is ready on ${E(H.hostLabel(h))}</h3><p>Clisbot runs the coding agents you already use. Set one up on this computer, then check again.</p></div></div>
      <div class="setup-steps">${Object.keys(h.providers)
        .slice(0, 3)
        .map(
          (id) =>
            `<div class="step"><span class="n">${H.pv(id)}</span><div class="grow"><div class="st">${H.providers[id].name} <span class="pill warn">${how[id][0]}</span></div><div class="sd">${how[id][1]}</div></div></div>`,
        )
        .join("")}</div>
      <div class="setup-foot"><span class="grow">Your draft is kept.</span><button class="btn sm solid" data-a="providers-check">${I("refresh", "sm")} Check again</button><button class="btn sm" data-a="sheet" data-sheet="pair">Use another computer</button></div></div>`;
  }
  if (b.kind === "all-offline")
    return `<div class="setup"><div class="setup-h"><span class="glyph">${I("offline", "lg")}</span><div><h3>Can't reach your computers</h3><p>Your draft is kept. Reconnect one to send.</p></div></div>
    <div class="setup-steps">${S.hosts
      .map(
        (
          h,
        ) => `<div class="step"><span class="n">${I(H.hostIcon(h), "sm")}</span><div class="grow"><div class="st">${E(H.hostLabel(h))} <span class="quiet small">· ${E(H.hostVia(h))} · last seen ${E(h.lastSeen || "")}</span></div></div>
      ${h.status === "connecting" ? `<span class="pill">${I("loader", "sm spin")} Connecting</span>` : `<button class="btn sm" data-a="reconnect" data-id="${h.id}">${I("refresh", "sm")} Reconnect</button>`}</div>`,
      )
      .join("")}</div>${remoteFoot()}</div>`;
  if (b.kind === "bot-offline")
    return `<div class="notice warn">${I("offline")}<div class="grow"><b>${E(H.bot(ctx.target.botId).name)}</b> runs on ${E(b.host.name)}, which is offline.
    <div class="acts"><button class="btn sm" data-a="reconnect" data-id="${b.host.id}">Reconnect</button><button class="btn sm ghost" data-a="target-agent">Start an agent session instead</button></div></div></div>`;
  if (b.kind === "no-project")
    return `<div class="notice info">${I("folder")}<div class="grow">Agent sessions work in a project folder on ${E(H.hostLabel(b.host))}.
    <div class="acts"><button class="btn sm solid" data-a="pop" data-pop="project" data-anchor="project">Choose project</button><button class="btn sm" data-a="sheet" data-sheet="add-project">Add a project</button></div></div></div>`;
  return "";
};
U.starterHint = (ctx) =>
  ctx.target.kind === "starter" && ctx.canSend
    ? `<div class="c-hint">${I("spark")}<span>Your first message creates <b style="color:var(--fg);font-weight:500">Personal assistant</b>, a bot with its own folder on ${E(H.hostLabel(ctx.host))} · ${E(H.providers[ctx.target.provider].name)} · Default permissions.</span> <button class="link" data-a="pop" data-pop="project" data-anchor="project">Work in a project instead</button></div>`
    : "";

// ---------- Sidebar and header (current product layout) ----------
U.sidebar = () => {
  const S = H.S;
  const projects = S.projects.filter((p) => !p.botHome && !p.scratch);
  return `<aside class="sidebar">
    <div class="sb-brand">${H.logo}Clisbot</div>
    <div class="sb-nav">
      ${[
        ["plus", "New workspace"],
        ["history", "History"],
        ["automation", "Automations"],
        ["grid", "Connectors"],
      ]
        .map(([i, t]) => `<button class="sb-item" data-a="nav" data-id="${t}">${I(i)}${t}</button>`)
        .join("")}
    </div>
    <div class="sb-scroll">
      <div class="sb-head">${I("bot")}Bots<button class="sb-act" data-a="nav" data-id="Create bot">${I("plus", "sm")}</button></div>
      ${
        S.bots.length
          ? S.bots
              .map(
                (b) =>
                  `<button class="sb-row" data-a="pick-bot" data-id="${b.id}"><span class="badge">${E(b.initials)}</span><span class="ell">${E(b.name)}</span></button>`,
              )
              .join("")
          : '<div class="sb-empty"><b style="color:var(--fg)">No bots yet</b><br>Your first message on Home creates one.</div>'
      }
      <div class="sb-head">${I("grid")}Projects<button class="sb-act" data-a="sheet" data-sheet="add-project">${I("plus", "sm")}</button></div>
      ${
        projects.length
          ? projects
              .map((p) => {
                const ss = S.sessions.filter((s) => s.projectId === p.id).slice(0, 2);
                const h = H.host(p.hostId);
                return `<button class="sb-row" data-a="pick-project" data-id="${p.id}"><span class="badge">${E(p.name[0].toUpperCase())}</span><span class="ell grow">${E(p.name)}</span>${h && h.status !== "online" ? I("offline", "sm") : ""}</button>
          ${ss.map((s) => `<button class="sb-sub" data-a="open-session" data-id="${s.id}">${s.status === "running" ? '<span class="dot run"></span>' : s.status === "needs" ? '<span class="dot warn"></span>' : '<span class="dot" style="opacity:.35"></span>'}<span class="ell">${E(s.title)}</span><span class="t">${H.ago(s.ago)}</span></button>`).join("")}`;
              })
              .join("")
          : '<div class="sb-empty">No projects yet</div>'
      }
    </div>
    <div class="sb-foot"><button class="sb-new" data-a="focus" title="New">${I("plus")}</button>
      <button class="sb-search" data-a="nav" data-id="Search">${I("search", "sm")}Search<kbd>⌘K</kbd></button>
      <button class="sb-icon" data-a="nav" data-id="Usage" title="Usage">${I("gauge")}</button>
      <button class="sb-icon" data-a="sheet" data-sheet="hosts" title="Hosts">${I("server")}</button>
      <button class="sb-icon" data-a="nav" data-id="Help" title="Help">${I("help")}</button>
      <button class="sb-icon" data-a="nav" data-id="Settings" title="Settings">${I("settings")}</button></div>
  </aside>`;
};
U.header = (extra = "") => {
  if (H.compact) {
    const ctx = H.resolve();
    const h = ctx.host;
    return `<header class="header"><button class="hbtn" data-a="nav" data-id="Menu">${I("menu", "lg")}</button><span class="title">Home</span><span class="grow"></span>${extra}
      <button class="hbtn" data-a="sheet" data-sheet="hosts" title="Hosts">${I(h ? H.hostIcon(h) : "server", "lg")}<span class="dot ${h && h.status === "online" ? "ok" : "off"}" style="position:absolute;right:6px;bottom:7px"></span></button></header>`;
  }
  return `<header class="header"><button class="hbtn" data-a="nav" data-id="Toggle sidebar">${I("panel")}</button><span class="title">Home</span><span class="grow"></span>${extra}</header>`;
};

// ---------- Popovers ----------
const opt = (a, inner, extra = "") =>
  `<button class="opt" data-a="${a}" ${extra}>${inner}</button>`;
U.pop = (ctx) => {
  const S = H.S;
  const kind = S.pop?.kind;
  const custom = H.concept.pop?.(kind, ctx);
  if (custom) return custom;
  if (kind === "host") {
    const hosts = [...S.hosts].sort(
      (a, b) => H.isLocal(b) - H.isLocal(a) || (a.usedAgo ?? 1e9) - (b.usedAgo ?? 1e9),
    );
    return `<div class="pop-h">New message runs on</div>${
      hosts
        .map((h) => {
          const on = h.status === "online";
          const ready = H.readyProviders(h).length;
          const sub = on
            ? `${H.hostVia(h)} · ${ready ? `${ready} agent${ready > 1 ? "s" : ""} ready` : "no agent ready"}`
            : h.status === "connecting"
              ? "Connecting…"
              : `${h.status === "starting" ? "Starting…" : `Offline · last seen ${h.lastSeen || "—"}`}`;
          const right = on
            ? ctx.host?.id === h.id
              ? I("check", "check")
              : ""
            : h.status === "offline"
              ? `<span class="btn sm" style="margin-left:auto" data-a="reconnect" data-id="${h.id}">Reconnect</span>`
              : "";
          return opt(
            on ? "pick-host" : "noop",
            `${I(H.hostIcon(h))}<span class="grow"><span class="ell" style="display:block">${E(H.hostLabel(h))}${H.isLocal(h) ? ` <span class="quiet small">· ${E(h.name)}</span>` : ""}</span><span class="od">${E(sub)}</span></span><span class="dot ${on ? "ok" : "off"}"></span>${right}`,
            `data-id="${h.id}"`,
          );
        })
        .join("") ||
      '<div class="quiet small" style="padding:8px">No computers connected yet.</div>'
    }
      <hr>${opt("sheet", `${I("plus")}<span class="grow">Connect a computer<span class="od" style="display:block">Pairing link, QR, address or SSH</span></span>`, 'data-sheet="pair"')}`;
  }
  if (kind === "project") {
    const list = ctx.host ? H.projectsOn(ctx.host.id) : [];
    return `<div class="pop-h">Projects on ${E(ctx.host ? H.hostLabel(ctx.host) : "")}</div>${list.map((p) => opt("pick-project", `${I("folder")}<span class="grow"><span class="ell" style="display:block">${E(p.name)}</span><span class="od ell" style="display:block">${E(p.path)}</span></span>${ctx.project?.id === p.id ? I("check", "check") : ""}`, `data-id="${p.id}"`)).join("")}
      ${list.length ? "<hr>" : ""}${opt("pick-personal", `${I("spark")}<span class="grow">No project — chat with a personal assistant<span class="od" style="display:block">A bot with its own folder; good for questions and writing</span></span>${ctx.target.kind === "starter" ? I("check", "check") : ""}`)}
      ${opt("sheet", `${I("plus")}<span class="grow">Add a project…</span>`, 'data-sheet="add-project"')}`;
  }
  if (kind === "target") {
    const h = ctx.reason === "bot" ? H.host(S.memory.last?.hostId) || ctx.host : ctx.host;
    const ids = Object.keys(H.providers);
    return `<div class="pop-h">Agent session on ${E(h ? H.hostLabel(h) : "")}</div>${ids
      .map((id) => {
        const st = h?.providers[id];
        const ok = st === "ready";
        return opt(
          ok ? "pick-provider" : "noop",
          `${H.pv(id)}<span class="grow">${H.providers[id].name}<span class="od" style="display:block">${ok ? H.providers[id].model : st === "signin" ? "Not signed in" : "Not installed"}</span></span>${ctx.target.provider === id && ctx.target.kind !== "bot" ? I("check", "check") : ""}`,
          `data-id="${id}" ${ok ? "" : "disabled"}`,
        );
      })
      .join("")}${
      S.bots.length
        ? `<hr><div class="pop-h">Chat with a bot</div>${S.bots
            .map((b) => {
              const bh = H.host(b.hostId);
              return opt(
                "pick-bot",
                `<span class="pill" style="padding:0 5px">${E(b.initials)}</span><span class="grow">${E(b.name)}<span class="od" style="display:block">${E(H.hostLabel(bh))}${bh.status === "online" ? "" : " · offline"}</span></span>${ctx.target.botId === b.id ? I("check", "check") : ""}`,
                `data-id="${b.id}"`,
              );
            })
            .join("")}`
        : ""
    }`;
  }
  if (kind === "thinking")
    return `<div class="pop-h">Thinking</div>${["Low", "Medium", "High"].map((t) => opt("set", `${t}${(S.thinking || "High") === t ? I("check", "check") : ""}`, `data-k="thinking" data-v="${t}"`)).join("")}`;
  if (kind === "perm")
    return `<div class="pop-h">Permissions</div>${[
      ["Default permissions", "Ask before edits and commands"],
      ["Accept edits", "Edit files without asking"],
      ["Plan", "Read and plan only"],
    ]
      .map(([t, d]) =>
        opt(
          "set",
          `<span class="grow">${t}<span class="od" style="display:block">${d}</span></span>${(S.perm || "Default permissions") === t ? I("check", "check") : ""}`,
          `data-k="perm" data-v="${t}"`,
        ),
      )
      .join("")}`;
  return "";
};

// ---------- Sheets ----------
U.sheet = (ctx) => {
  const S = H.S;
  const [kind, id] = (S.sheet || "").split(":");
  const custom = H.concept.sheet?.(kind, id, ctx);
  if (custom) return custom;
  const shell = (title, body, foot = "") =>
    `<div class="sheet" role="dialog" aria-label="${E(title)}"><div class="sheet-h"><h3 class="grow">${title}</h3><button class="hbtn" data-a="close">${I("x")}</button></div><div class="sheet-b">${body}</div>${foot ? `<div class="sheet-f">${foot}</div>` : ""}</div>`;
  if (kind === "pair") {
    const m = S.pair.method;
    const methods = H.compact
      ? [
          ["qr", "Scan QR"],
          ["link", "Paste link"],
        ]
      : [
          ["link", "Pairing link"],
          ["direct", "Address"],
          ["ssh", "SSH"],
        ];
    const st = S.pair.state;
    const body = `<p class="muted" style="margin:0">On the computer: <b>Settings → your host → Pair Device</b>. It shows a QR code and a link.</p>
      <div class="tabs">${methods.map(([k, t]) => `<button class="${m === k ? "on" : ""}" data-a="pair-method" data-id="${k}">${t}</button>`).join("")}</div>
      ${
        m === "qr"
          ? `<div class="qr">${I("qr", "lg")}</div><p class="quiet small" style="text-align:center;margin:0">Point the camera at the QR code on your computer.</p>`
          : m === "link"
            ? '<div class="field"><label>Pairing link</label><input value="https://app.clisbot.com/pair#offer=…" aria-label="Pairing link"></div>'
            : m === "direct"
              ? '<div class="field"><label>Address</label><input value="office-imac.tailnet.ts.net:6767"></div><p class="quiet small" style="margin:0">Over Tailscale, a VPN or your local network.</p>'
              : '<div class="field"><label>SSH</label><input value="me@build-box"></div><p class="quiet small" style="margin:0">Clisbot starts the daemon over SSH and forwards the port.</p>'
      }
      ${st === "error" ? `<div class="notice warn">${I("alert")}<div>This link expired. Make a new one on the computer, then try again. What you typed is kept.</div></div>` : ""}
      <p class="quiet small" style="margin:0">${I("lock", "sm")} End-to-end encrypted. Agents and code stay on that computer.</p>`;
    const foot = `<button class="btn ghost sm" data-a="pair-expire">Simulate expired link</button><span class="grow"></span><button class="btn" data-a="close">Cancel</button>
      <button class="btn solid" data-a="pair-go" ${st === "busy" ? "disabled" : ""}>${st === "busy" ? `${I("loader", "sm spin")} Connecting…` : m === "qr" ? "Scan (demo)" : "Connect"}</button>`;
    return shell("Connect a computer", body, foot);
  }
  if (kind === "hosts") {
    return shell(
      "Hosts",
      `${
        S.hosts
          .map(
            (
              h,
            ) => `<div class="row" style="border:1px solid var(--border);border-radius:10px">${`<span class="ri">${I(H.hostIcon(h))}</span>`}<span class="grow"><span class="rt" style="display:block">${E(H.hostLabel(h))}${H.isLocal(h) ? ` <span class="quiet small">· ${E(h.name)}</span>` : ""}</span><span class="rm">${E(H.hostVia(h))} · v${E(h.version)} · ${
              H.readyProviders(h)
                .map((p) => H.providers[p].name)
                .join(", ") || "no agent ready"
            }</span></span>
      ${h.status === "online" ? '<span class="pill ok">Online</span>' : h.status === "connecting" ? '<span class="pill">Connecting</span>' : `<button class="btn sm" data-a="reconnect" data-id="${h.id}">Reconnect</button>`}</div>`,
          )
          .join("") || '<div class="empty">No computers connected yet.</div>'
      }`,
      `<button class="btn solid" data-a="sheet" data-sheet="pair">${I("plus", "sm")} Connect a computer</button>`,
    );
  }
  if (kind === "add-project") {
    const h = ctx.host || S.hosts.find(H.online);
    return shell(
      "Add a project",
      `<p class="muted" style="margin:0">Any folder on <b>${E(h ? H.hostLabel(h) : "a host")}</b>: code, docs, research or data.</p><div class="field"><label>Folder</label><input id="newpath" value="~/projects/website"></div>`,
      `<button class="btn" data-a="close">Cancel</button><button class="btn solid" data-a="add-project" ${h ? "" : "disabled"}>Add project</button>`,
    );
  }
  if (kind === "session") {
    const s = S.sessions.find((x) => x.id === id);
    const h = H.host(s.hostId);
    const off = h.status !== "online";
    return shell(
      E(s.title),
      `<dl class="kv"><dt>Type</dt><dd>${s.kind === "chat" ? "Chat" : "Agent session"} · ${E(H.sessionWho(s))}</dd><dt>Project</dt><dd>${E(H.project(s.projectId)?.name)}</dd><dt>Host</dt><dd>${E(H.hostLabel(h))}${off ? " · offline" : ""}</dd><dt>Last</dt><dd>${E(s.preview)}</dd></dl>
      ${off ? `<div class="notice warn">${I("offline")}<div>This session stays on <b>${E(h.name)}</b>. Reconnect it to continue; Home never moves an existing session to another host.</div></div>` : ""}
      ${s.status === "needs" ? `<div class="notice">${I("bell")}<div class="grow"><b>${E(s.ask)}</b><div class="acts"><button class="btn sm solid" data-a="approve" data-id="${s.id}">Approve</button><button class="btn sm" data-a="deny" data-id="${s.id}">Deny</button></div></div></div>` : ""}`,
      off
        ? `<button class="btn solid" data-a="reconnect" data-id="${h.id}">Reconnect ${E(h.name)}</button>`
        : `<button class="btn solid" data-a="open-real" data-id="${s.id}">Open ${s.kind === "chat" ? "chat" : "session"}</button>`,
    );
  }
  if (kind === "schedule") {
    const k = S.schedules.find((x) => x.id === id);
    const h = H.host(k.hostId);
    return shell(
      E(k.name),
      `<dl class="kv"><dt>Type</dt><dd>${E(k.kind)}</dd><dt>When</dt><dd>${E(k.cadence)}</dd><dt>Next</dt><dd>${k.paused ? "Paused" : `${E(k.day)} ${E(k.at)} · ${E(H.inText(k.inMin))}`}</dd><dt>Runs</dt><dd>${E(k.target)} · ${E(k.runIn)}</dd><dt>Project</dt><dd>${E(H.project(k.projectId)?.name)}</dd><dt>Host</dt><dd>${E(H.hostLabel(h))}${h.status === "online" ? "" : " · offline"}</dd><dt>Time zone</dt><dd>Asia/Ho_Chi_Minh (UTC+7)</dd></dl>
      ${k.failed ? `<div class="notice warn">${I("alert")}<div>Last run failed: ${E(k.failed)}</div></div>` : ""}
      ${h.status !== "online" ? `<div class="notice warn">${I("offline")}<div>${E(h.name)} is offline. This run is skipped unless it reconnects in time.</div></div>` : ""}`,
      `<button class="btn" data-a="toggle-pause" data-id="${k.id}">${k.paused ? `${I("play", "sm")} Resume` : `${I("pause", "sm")} Pause`}</button><button class="btn solid" data-a="run-now" data-id="${k.id}" ${h.status === "online" ? "" : "disabled"}>Run now</button>`,
    );
  }
  return "";
};

// ---------- Review chrome ----------
const FILES = [
  ["01-start.html", "01 Start"],
  ["02-hosts.html", "02 Hosts"],
  ["03-inbox.html", "03 Inbox"],
  ["04-home.html", "04 Home · tổng hòa"],
  ["05-app.html", "05 App · tabs + Hub"],
  ["06-home.html", "06 Home = New workspace"],
];
U.review = () => {
  const S = H.S;
  const hash = location.hash;
  return `<div class="review">
    <span class="review-title">Clisbot Home</span>
    <nav class="review-files">${FILES.map(([f, t], i) => `<a href="${f}${hash}" class="${i + 1 === H.concept.num ? "on" : ""}">${t}</a>`).join("")}</nav>
    ${
      H.concept.variants
        ? U.variantSelect()
        : `<label>Trạng thái <select data-change="scenario">${H.scenarios.map((s) => `<option value="${s.id}" ${s.id === S.scenario ? "selected" : ""}>${E(s.label)}</option>`).join("")}</select></label>
    ${H.concept.reviewExtra?.() || ""}`
    }
    <span class="seg">${[
      ["desktop", "monitor", "Desktop"],
      ["web", "globe", "Web"],
      ["mobile", "phone", "Mobile"],
    ]
      .filter(([d]) => !H.concept.devices || H.concept.devices.includes(d))
      .map(
        ([d, i, t]) =>
          `<button class="${S.device === d ? "on" : ""}" data-a="device" data-id="${d}">${I(i, "sm")}${t}</button>`,
      )
      .join("")}</span>
    <span class="spacer"></span>
    <button class="review-btn" data-a="theme">${I(S.theme === "dark" ? "sun" : "moon", "sm")}${S.theme === "dark" ? "Sáng" : "Tối"}</button>
    <button class="review-btn ${S.notes ? "on" : ""}" data-a="notes">${I("notes", "sm")}Ghi chú thiết kế</button>
    <button class="review-btn" data-a="reset">${I("refresh", "sm")}Đặt lại</button>
    <div class="scenario-hint">${I("info", "sm")} ${E(H.currentVariant()?.hint || S.sc.hint)}</div>
  </div>`;
};

// A concept may offer a few curated variants (scenario per device + Hub) instead of every scenario.
H.currentVariant = () =>
  H.concept.variants?.find(
    (v) => Object.values(v.scenario).includes(H.S.scenario) && v.hub === H.S.hub,
  );
H.seedVariant = (v, device) => {
  const S = H.S;
  H.seed(v.scenario[device] || v.scenario.desktop, {
    device,
    theme: S.theme,
    notes: S.notes,
    hub: v.hub,
  });
};
U.variantSelect = () => {
  const cur = H.currentVariant();
  return `<label>Biến thể <select data-change="variant">${H.concept.variants.map((v) => `<option value="${v.id}" ${cur?.id === v.id ? "selected" : ""}>${E(v.label)}</option>`).join("")}</select></label>`;
};
