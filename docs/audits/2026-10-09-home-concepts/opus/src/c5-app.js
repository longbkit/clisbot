/* oxlint-disable no-nested-ternary, complexity -- prototype view templates read as one expression per state. */
/* 05 · App — standard navigation: Home, Chat, Inbox, Schedules, Settings (bottom tabs on mobile,
   the sidebar on desktop, where Chat is the current sidebar). Home leads with Host health, then chat.
   Hosts scale from no Hub to several Hubs, one of them a company Hub with 124 Hosts. */
(() => {
  const { icon: I, esc: E, ui: U } = H;

  // ---------- Hubs and the Hosts they bring ----------
  const HUBS = {
    personal: {
      id: "personal",
      name: "Long's Hub",
      kind: "Personal",
      url: "long.hub.clisbot.com",
      role: "Owner",
    },
    vexere: {
      id: "vexere",
      name: "Vexere",
      kind: "Company",
      url: "hub.vexere.com",
      role: "Member",
      managed: true,
    },
    lab: {
      id: "lab",
      name: "Home lab",
      kind: "Personal",
      url: "lab.hub.clisbot.com",
      role: "Owner",
    },
  };
  const range = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));
  const pad = (i) => String(i).padStart(2, "0");
  const people = [
    "an",
    "binh",
    "chi",
    "dung",
    "giang",
    "ha",
    "hieu",
    "hoa",
    "huy",
    "khanh",
    "khoa",
    "lan",
    "linh",
    "long",
    "mai",
    "minh",
    "nam",
    "ngoc",
    "phuc",
    "quan",
    "quang",
    "son",
    "tam",
    "thao",
    "thu",
    "trang",
    "trung",
    "tuan",
    "vy",
    "yen",
  ];
  function companyHosts() {
    const names = [
      ...range(12, (i) => `build-${pad(i)}`),
      ...range(8, (i) => `gpu-a100-${pad(i)}`),
      ...range(
        10,
        (i) => `staging-${["api", "web", "worker", "db", "search"][i % 5]}-${Math.ceil(i / 5)}`,
      ),
      ...range(34, (i) => `ci-runner-${pad(i)}`),
      ...people.flatMap((p) => [`dev-${p}`, `dev-${p}-mbp`]),
    ];
    return names.map((name, i) => ({
      id: `vx-${name}`,
      name,
      kind: "remote",
      hubId: "vexere",
      via: "Vexere Hub",
      managed: true,
      version: "0.11.1",
      status: i % 31 === 7 ? "offline" : i % 41 === 5 ? "updating" : "online",
      lastSeen: "1 h ago",
      providers: { claude: "ready", codex: "ready", opencode: "missing", copilot: "missing" },
      usedAgo: { "dev-long": 600, "gpu-a100-02": 50, "staging-api-1": 2900 }[name] ?? null,
    }));
  }
  function seedHubs(S) {
    S.tab = "home";
    S.hubs = [];
    S.hostq = "";
    S.browseq = "";
    S.browseFilter = "all";
    S.groups = [{ id: "g1", name: "Launch team", bots: ["product", "ops"], ago: 40 }];
    if (S.sc.fresh) {
      S.groups = [];
      return;
    }
    if (S.hub === "none") {
      S.hosts.forEach((h) => {
        if (h.via === "Relay") h.via = "Direct · Relay";
      });
      return;
    }
    S.hubs.push({ ...HUBS.personal, status: "online" });
    S.hosts.forEach((h) => {
      h.hubId = "personal";
      if (h.kind !== "local") h.via = "Long's Hub";
    });
    if (S.hub !== "many") return;
    S.hubs.push(
      { ...HUBS.vexere, status: "online", total: 124 },
      { ...HUBS.lab, status: "signin" },
    );
    S.hosts.push(
      ...companyHosts(),
      ...["pi-garage", "nas-home"].map((name) => ({
        id: `lab-${name}`,
        name,
        kind: "remote",
        hubId: "lab",
        via: "Home lab Hub",
        status: "unknown",
        version: "0.11.0",
        providers: { claude: "ready", codex: "missing", opencode: "missing", copilot: "missing" },
        usedAgo: null,
      })),
    );
    S.projects.push(
      {
        id: "ml",
        hostId: "vx-gpu-a100-02",
        name: "ml-pipeline",
        path: "/data/ml-pipeline",
        usedAgo: 50,
      },
      {
        id: "booking",
        hostId: "vx-staging-api-1",
        name: "booking-api",
        path: "/srv/booking-api",
        usedAgo: 2900,
      },
      {
        id: "dev-long-web",
        hostId: "vx-dev-long",
        name: "vexere-web",
        path: "~/work/vexere-web",
        usedAgo: 600,
      },
    );
    S.sessions.push({
      id: "s8",
      kind: "agent",
      provider: "claude",
      title: "Tune ranking model",
      preview: "Eval improved 2.1% on the holdout set.",
      projectId: "ml",
      hostId: "vx-gpu-a100-02",
      status: "idle",
      ago: 50,
    });
    S.memory.byHost["vx-gpu-a100-02"] = "ml";
    if (S.sc.allOffline) {
      S.hubs.forEach((hub) => {
        hub.status = "unreachable";
      });
      S.hosts.forEach((h) => {
        h.status = "offline";
        h.lastSeen = h.lastSeen || "6 min ago";
      });
    }
  }

  // ---------- Derived host facts ----------
  const hub = (id) => H.S.hubs.find((x) => x.id === id);
  const isOn = (h) => h.status === "online";
  const local = () => H.S.hosts.find((h) => H.isLocal(h));
  const groups = () => {
    const S = H.S;
    const out = [];
    const direct = S.hosts.filter((h) => !h.hubId && !H.isLocal(h));
    if (direct.length)
      out.push({
        id: "direct",
        title: "Direct connections",
        sub: "Paired with this device",
        hosts: direct,
      });
    S.hubs.forEach((x) =>
      out.push({
        id: x.id,
        hub: x,
        title: x.name,
        sub: `${x.kind} Hub · ${x.url}`,
        hosts: S.hosts.filter((h) => h.hubId === x.id && !H.isLocal(h)),
      }),
    );
    return out;
  };
  const usedFirst = (list) => [...list].sort((a, b) => (a.usedAgo ?? 1e9) - (b.usedAgo ?? 1e9));
  const busy = (h) =>
    H.S.sessions.some((s) => s.hostId === h.id) ||
    H.S.schedules.some((k) => k.hostId === h.id && !k.paused);
  // Only what the user can act on: offline Hosts they use, Hubs that need sign-in or can't be reached.
  const issues = () => {
    const S = H.S;
    const list = S.hosts
      .filter((h) => h.status === "offline" && (busy(h) || (h.usedAgo ?? 1e9) < 4320))
      .map((h) => ({
        kind: "host",
        h,
        title: `${H.hostLabel(h)} is offline`,
        text: `${busy(h) ? "Has sessions or schedules · " : ""}last seen ${h.lastSeen || "—"}`,
      }));
    S.hubs
      .filter((x) => x.status === "signin")
      .forEach((x) =>
        list.push({
          kind: "signin",
          hub: x,
          title: `${x.name} Hub needs you to sign in again`,
          text: "Its Hosts are hidden until you do",
        }),
      );
    S.hubs
      .filter((x) => x.status === "unreachable")
      .forEach((x) =>
        list.push({
          kind: "unreachable",
          hub: x,
          title: `Can't reach ${x.name} Hub`,
          text: "Check your network",
        }),
      );
    return list;
  };
  const counts = (hosts) => ({ on: hosts.filter(isOn).length, all: hosts.length });
  const statusDot = (h) =>
    `<span class="dot ${isOn(h) ? "ok" : h.status === "updating" || h.status === "connecting" ? "warn" : "off"}" title="${E(h.status)}"></span>`;
  const hostIcon = (h) => I(h.managed ? "shield" : H.hostIcon(h), "sm");

  // ---------- Host health: the first thing on Home ----------
  const fixBtn = (it) =>
    it.kind === "host"
      ? `<button class="btn sm" data-a="sheet" data-sheet="fix:${it.h.id}">Fix</button>`
      : it.kind === "signin"
        ? `<button class="btn sm solid" data-a="c5-signin" data-id="${it.hub.id}">Sign in</button>`
        : `<button class="btn sm" data-a="sheet" data-sheet="help">Help</button>`;
  function hostBar(ctx, { pairRow = true } = {}) {
    const S = H.S;
    const iss = issues();
    const l = local();
    const blocked =
      ctx.blocker &&
      ["probing", "web-missing", "web-blocked", "mobile-pair", "starting"].includes(
        ctx.blocker.kind,
      );
    const chips = [
      l
        ? `<button class="c5-hchip" data-a="sheet" data-sheet="hosts">${I(H.hostIcon(l), "sm")}${E(H.hostLabel(l))}${statusDot(l)}</button>`
        : "",
      ...groups().map((g) => {
        const c = counts(g.hosts);
        const st =
          g.hub?.status === "signin"
            ? '<span class="pill warn">Sign in</span>'
            : g.hub?.status === "unreachable"
              ? '<span class="pill warn">Unreachable</span>'
              : `<span class="quiet">${c.on}/${c.all}</span>`;
        return `<button class="c5-hchip" data-a="sheet" data-sheet="${g.hub ? `hub:${g.hub.id}` : "hosts"}">${I(g.hub?.managed ? "shield" : g.hub ? "globe" : "link", "sm")}${E(g.hub ? g.title : "Direct")} ${st}</button>`;
      }),
    ].filter(Boolean);
    const all = S.hosts.filter((h) => h.status !== "unknown");
    const summary = !S.hosts.length
      ? blocked
        ? H.ui.why(ctx)
        : "No computer connected yet"
      : `${counts(all).on} of ${all.length} host${all.length > 1 ? "s" : ""} online${S.hubs.length ? ` · ${S.hubs.length} Hub${S.hubs.length > 1 ? "s" : ""}` : ""}`;
    return `<section class="c5-hostbar ${iss.length ? "warn" : ""}">
      <div class="c5-hostbar-top"><span class="c5-hb-title">${I("server", "sm")}<b>Hosts</b><span class="quiet">${E(summary)}</span></span>
        <div class="c5-hb-chips">${chips.join("")}</div>
        <span class="c5-hb-acts"><button class="btn sm" data-a="pop" data-pop="c5-connect" data-anchor="c5-connect">${I("plus", "sm")} Connect</button><button class="btn sm ghost" data-a="sheet" data-sheet="help">${I("help", "sm")}<span class="c5-hide-sm">Help</span></button></span></div>
      ${!pairRow || (!S.hosts.length && !blocked) ? "" : !S.hosts.length ? `<div class="c5-issues"><div class="c5-issue">${I("monitor", "sm")}<span class="grow"><b>Pair your computer</b> <span class="quiet">· or, at work, add your company's Hub to see the Hosts it shares with you</span></span><button class="btn sm solid" data-a="sheet" data-sheet="pair">Pair</button><button class="btn sm" data-a="sheet" data-sheet="add-hub">Add a Hub</button></div></div>` : ""}
      ${iss.length ? `<div class="c5-issues">${iss.map((it) => `<div class="c5-issue">${I(it.kind === "host" ? "offline" : "alert", "sm")}<span class="grow"><b>${E(it.title)}</b> <span class="quiet">· ${E(it.text)}</span></span>${fixBtn(it)}</div>`).join("")}</div>` : ""}
    </section>`;
  }

  // ---------- Hero: promote chat ----------
  const mode = (ctx) =>
    ctx.target.kind === "agent"
      ? "project"
      : ctx.target.kind === "bot" && ctx.target.botId !== "personal"
        ? "bot"
        : "quick";
  function modes(ctx) {
    const m = mode(ctx);
    const b = ctx.target.kind === "bot" && m === "bot" ? H.bot(ctx.target.botId) : null;
    return `<div class="c5-modes" role="tablist">
      <button class="${m === "quick" ? "on" : ""}" data-a="c5-quick">${I("spark", "sm")}Quick chat<span class="c5-mode-sub">no project</span></button>
      <button class="${m === "bot" ? "on" : ""}" data-a="pop" data-pop="c5-bots" data-anchor="c5-bots">${I("bot", "sm")}${b ? E(b.name) : "Bot"}${I("down", "sm")}</button>
      <button class="${m === "project" ? "on" : ""}" data-a="c5-project">${I("folder", "sm")}${m === "project" && ctx.project ? E(ctx.project.name) : "Project"}${I("down", "sm")}</button>
    </div>`;
  }
  const hero = (ctx) => `<section class="c5-hero">
      <h1>${H.S.sessions.length ? "What do you want to do?" : "Start with a message"}</h1>
      ${modes(ctx)}
      ${U.ctxLine(ctx, { label: "Runs on", remote: false })}
      ${U.notice(ctx)}${U.composer(ctx, { rows: H.compact ? 2 : 3 })}${U.starterHint(ctx)}${U.setup(ctx)}
    </section>`;

  // ---------- Templates: prompt only, or with a Bot / a Project ----------
  const PROMPTS = [
    ["Draft an email", "Draft a short, friendly email to "],
    ["Plan my week", "Help me plan my week. Ask me what's on my plate first."],
    ["Explain a concept", "Explain like I'm new to it: "],
    ["Summarize a link", "Summarize this page in 5 bullets: "],
  ];
  const BOT_TPL = [
    {
      id: "standup",
      name: "Daily standup bot",
      text: "Posts a summary of yesterday's work every weekday at 9:00.",
      adds: "Bot + weekday schedule",
      icon: "automation",
    },
    {
      id: "triage",
      name: "Inbox triage bot",
      text: "Reads new mail, drafts replies, flags what needs you.",
      adds: "Bot + Gmail connector",
      icon: "inbox",
    },
    {
      id: "research",
      name: "Research assistant",
      text: "Searches the web and keeps notes in its own folder.",
      adds: "Bot + web search",
      icon: "search",
    },
  ];
  const PROJ_TPL = [
    {
      id: "review",
      name: "Review a pull request",
      text: "Review the open PR on this branch and list risks.",
      icon: "branch",
    },
    {
      id: "tests",
      name: "Fix failing tests",
      text: "Run the test suite, find the failing tests and fix them.",
      icon: "check",
    },
    {
      id: "tour",
      name: "Explain this codebase",
      text: "Give me a tour of this project: structure, entry points, how to run it.",
      icon: "folder",
    },
  ];
  const templates =
    () => `<section class="c5-tpl"><div class="sec-h"><h2>Start from a template</h2><div class="right"><button class="btn sm" data-a="sheet" data-sheet="tpl:blank">${I("bot", "sm")} Create bot</button></div></div>
    <div class="c5-tpl-grid">
      <div class="c5-tpl-col"><div class="c5-tpl-h">Just ask <span class="pill">No bot or project</span></div><div class="c5-tpl-list">${PROMPTS.map(([t, text]) => `<button class="c5-prompt" data-a="c5-prompt" data-text="${E(text)}">${I("chat", "sm")}${t}</button>`).join("")}</div></div>
      <div class="c5-tpl-col"><div class="c5-tpl-h">Comes with a bot <span class="pill ok">Creates a bot</span></div><div class="c5-tpl-list">${BOT_TPL.map((t) => `<button class="c5-card" data-a="sheet" data-sheet="tpl:${t.id}"><span class="ri">${I(t.icon)}</span><span class="grow"><b>${t.name}</b><span class="rm">${t.text}</span><span class="c5-adds">${I("plus", "sm")}${t.adds}</span></span></button>`).join("")}</div></div>
      <div class="c5-tpl-col"><div class="c5-tpl-h">Works in a project <span class="pill run">Needs a project</span></div><div class="c5-tpl-list">${PROJ_TPL.map((t) => `<button class="c5-card" data-a="c5-proj-tpl" data-id="${t.id}"><span class="ri">${I(t.icon)}</span><span class="grow"><b>${t.name}</b><span class="rm">${t.text}</span></span></button>`).join("")}</div></div>
    </div></section>`;

  // ---------- Lower Home: Inbox · Schedules & Hosts ----------
  const attnCard = (a) =>
    `<div class="c5-att">${U.attnIcon(a)}<div class="grow"><div class="rt ell">${E(a.title)}</div><div class="rm">${E(a.text)}</div>${a.s ? `<div class="rm">${U.meta(a.s)}</div>` : ""}</div><div class="acts">${U.attnActions(a)}</div></div>`;
  function inboxSection(limit = 3) {
    const att = H.attention().filter((a) => a.kind !== "offline");
    const updates = H.recent("all")
      .filter((s) => !["needs", "failed"].includes(s.status))
      .slice(0, limit);
    if (!att.length && !updates.length)
      return `<section><div class="sec-h"><h2>Inbox</h2></div><div class="empty">Replies, questions from agents and finished runs show up here.</div></section>`;
    return `<section><div class="sec-h"><h2>Inbox</h2>${att.length ? `<span class="pill warn">${att.length} need you</span>` : ""}<div class="right"><button class="btn ghost sm" data-a="c5-tab" data-id="inbox">Open Inbox ${I("right", "sm")}</button></div></div>
      ${att.length ? `<div class="c5-atts">${att.map(attnCard).join("")}</div>` : ""}
      <div class="rows" style="margin-top:8px">${updates.map((s) => U.sessionRow(s, { preview: true })).join("")}</div></section>`;
  }
  function schedulesSection(limit = 4) {
    const list = H.upcoming()
      .filter((k) => !k.paused)
      .slice(0, limit);
    return `<section><div class="sec-h"><h2>Schedules</h2><span class="sub">Up next</span><div class="right"><button class="btn ghost sm" data-a="c5-tab" data-id="schedules">All ${I("right", "sm")}</button></div></div>
      ${list.length ? `<div class="rows">${list.map(U.schedRow).join("")}</div>` : '<div class="empty">No schedules yet. <button class="link" data-a="nav" data-id="New schedule">New schedule</button></div>'}</section>`;
  }
  const hostRow = (
    h,
  ) => `<div class="c5-hrow">${hostIcon(h)}<button class="c5-hname grow ell" data-a="sheet" data-sheet="host:${h.id}" title="Agents, status and settings">${E(H.hostLabel(h))}${H.isLocal(h) ? ` <span class="quiet small">· ${E(h.name)}</span>` : ""}</button>
    <span class="quiet small c5-hide-sm">${h.usedAgo != null ? `used ${H.ago(h.usedAgo)} ago` : ""}</span>${statusDot(h)}
    ${h.status === "offline" ? `<button class="btn sm" data-a="sheet" data-sheet="fix:${h.id}">Fix</button>` : isOn(h) ? `<button class="btn sm ghost" data-a="c5-use-host" data-id="${h.id}">Use</button>` : `<span class="quiet small">${E(h.status)}</span>`}</div>`;
  function groupBlock(g, { limit = 3 } = {}) {
    const c = counts(g.hosts);
    const shown = usedFirst(g.hosts).slice(0, limit);
    const head = `<div class="c5-ghead">${I(g.hub?.managed ? "shield" : g.hub ? "globe" : "link", "sm")}<span class="grow ell"><b>${E(g.title)}</b> <span class="quiet small">${E(g.sub)}</span></span>
      ${g.hub?.status === "signin" ? `<button class="btn sm solid" data-a="c5-signin" data-id="${g.hub.id}">Sign in again</button>` : `<span class="quiet small">${c.on}/${c.all} online</span>`}</div>`;
    if (g.hub?.status === "signin")
      return `<div class="c5-group">${head}<div class="c5-hrow quiet small">${c.all} hosts hidden until you sign in.</div></div>`;
    return `<div class="c5-group">${head}${shown.map(hostRow).join("")}
      ${g.hosts.length > limit ? `<button class="c5-more" data-a="sheet" data-sheet="browse:${g.id}">${I("search", "sm")} Browse all ${g.hosts.length} hosts${g.hub?.managed ? " · Managed access" : ""}</button>` : ""}</div>`;
  }
  function hostsSection() {
    const l = local();
    return `<section><div class="sec-h"><h2>Hosts</h2><div class="right"><button class="btn ghost sm" data-a="sheet" data-sheet="help">${I("help", "sm")} Connection help</button></div></div>
      <div class="c5-groups">${l ? `<div class="c5-group">${hostRow(l)}</div>` : ""}${groups()
        .map((g) => groupBlock(g))
        .join("")}
      <div class="c5-connect-row"><button class="btn sm" data-a="sheet" data-sheet="pair">${I("monitor", "sm")} Connect a computer</button><button class="btn sm" data-a="sheet" data-sheet="add-hub">${I("globe", "sm")} Add a Hub</button></div></div></section>`;
  }
  function home(ctx) {
    const S = H.S;
    const active = S.sessions.length || S.schedules.length;
    const lower = active
      ? `<div class="c5-lower"><div class="c5-col">${inboxSection()}</div><div class="c5-col">${schedulesSection()}${hostsSection()}</div></div>`
      : `<div class="c5-lower one">${hostsSection()}</div>`;
    return `<div class="c5">${hostBar(ctx)}${hero(ctx)}${templates()}${lower}</div>`;
  }

  // ---------- Other tabs ----------
  const page = (title, sub, body, actions = "") =>
    `<div class="c5 c5-page"><div class="c5-page-h"><div><h1>${title}</h1>${sub ? `<div class="quiet">${sub}</div>` : ""}</div><div class="right">${actions}</div></div>${body}</div>`;
  function inboxPage() {
    const att = H.attention();
    const all = H.recent("all").filter((s) => !["needs", "failed"].includes(s.status));
    return page(
      "Inbox",
      "Questions from agents, failures and replies across all Hosts",
      `${att.length ? `<section><div class="sec-h"><h2>Needs you</h2><span class="pill warn">${att.length}</span></div><div class="c5-atts">${att.map(attnCard).join("")}</div></section>` : '<div class="empty">Nothing needs you.</div>'}
      <section><div class="sec-h"><h2>Updates</h2></div><div class="rows">${all.map((s) => U.sessionRow(s, { preview: true })).join("") || '<div class="empty">No updates yet.</div>'}</div></section>`,
    );
  }
  function schedulesPage() {
    const list = H.upcoming();
    const grp = [
      ["Today", list.filter((k) => !k.paused && k.day === "Today")],
      ["Later", list.filter((k) => !k.paused && k.day !== "Today")],
      ["Paused", list.filter((k) => k.paused)],
    ];
    return page(
      "Schedules",
      "Schedules and heartbeats on every Host · your time UTC+7",
      grp
        .filter(([, l]) => l.length)
        .map(
          ([t, l]) =>
            `<section><div class="sec-h"><h2>${t}</h2></div><div class="rows">${l.map(U.schedRow).join("")}</div></section>`,
        )
        .join("") || '<div class="empty">No schedules yet.</div>',
      `<button class="btn solid sm" data-a="nav" data-id="New schedule">${I("plus", "sm")} New schedule</button>`,
    );
  }
  function settingsPage() {
    const S = H.S;
    const hubs = S.hubs
      .map(
        (
          x,
        ) => `<div class="c5-hrow">${I(x.managed ? "shield" : "globe", "sm")}<span class="grow"><b>${E(x.name)}</b> <span class="quiet small">${E(x.kind)} · ${E(x.url)} · ${E(x.role)}</span></span>
      ${x.status === "online" ? '<span class="pill ok">Connected</span>' : x.status === "signin" ? `<button class="btn sm solid" data-a="c5-signin" data-id="${x.id}">Sign in again</button>` : '<span class="pill warn">Unreachable</span>'}<button class="btn sm ghost" data-a="sheet" data-sheet="hub:${x.id}">Details</button></div>`,
      )
      .join("");
    const row = (icon, t, d, a = "nav") =>
      `<button class="c5-set" data-a="${a}" data-id="${t}">${I(icon, "sm")}<span class="grow">${t}<span class="rm">${d}</span></span>${I("right", "sm")}</button>`;
    return page(
      "Settings",
      "",
      `<section><div class="sec-h"><h2>Hosts &amp; Hubs</h2></div><div class="c5-groups">${local() ? `<div class="c5-group">${hostRow(local())}</div>` : ""}${groups()
        .map((g) => groupBlock(g, { limit: 5 }))
        .join("")}
        <div class="c5-group"><div class="c5-ghead"><b class="grow">Your Hubs</b><span class="quiet small">${S.hubs.length || "None"}</span></div>${hubs || '<div class="c5-hrow quiet small">A Hub shares Hosts with you: your own, or your company\'s.</div>'}</div>
        <div class="c5-connect-row"><button class="btn sm" data-a="sheet" data-sheet="pair">${I("monitor", "sm")} Connect a computer</button><button class="btn sm" data-a="sheet" data-sheet="add-hub">${I("globe", "sm")} Add a Hub</button><button class="btn sm ghost" data-a="sheet" data-sheet="help">${I("help", "sm")} Fix a connection</button></div></div></section>
      <section><div class="sec-h"><h2>App</h2></div><div class="rows">${row(S.theme === "dark" ? "sun" : "moon", "Appearance", S.theme === "dark" ? "Dark" : "Light", "theme")}${row("bell", "Notifications", "Questions from agents, failed runs")}${row("grid", "Connectors", "Apps and MCP servers agents may use")}${row("gauge", "Usage", "Tokens and cost by provider")}</div></section>
      <section><div class="sec-h"><h2>Help &amp; support</h2></div><div class="rows">${row("help", "Docs", "clisbot.com/docs")}${row("chat", "Community", "Discord")}${row("alert", "Report a problem", "Sends logs you choose")}</div><p class="quiet small">Clisbot 0.11.1</p></section>`,
    );
  }
  function chatPage() {
    const S = H.S;
    const projects = S.projects.filter(
      (p) => !p.botHome && S.sessions.some((s) => s.projectId === p.id),
    );
    const sess = (s) =>
      `<button class="sb-sub" style="padding-left:12px" data-a="open-session" data-id="${s.id}">${s.status === "running" ? '<span class="dot run"></span>' : s.status === "needs" ? '<span class="dot warn"></span>' : '<span class="dot" style="opacity:.35"></span>'}<span class="ell">${E(s.title)}</span><span class="t">${H.ago(s.ago)}</span></button>`;
    return `<div class="c5 c5-chat"><div class="sb-search" style="height:38px">${I("search", "sm")}Search chats and sessions</div>
      <section><div class="sec-h"><h2>Bots</h2><div class="right"><button class="hbtn" data-a="sheet" data-sheet="tpl:blank" title="Create bot">${I("plus")}</button></div></div>
        <div class="rows">${
          S.bots
            .map((b) => {
              const last = S.sessions.find((s) => s.botId === b.id);
              return `<button class="row" data-a="pick-bot-chat" data-id="${b.id}"><span class="ri">${E(b.initials)}</span><span class="grow"><span class="rt" style="display:block">${E(b.name)}</span><span class="rm ell" style="display:block">${E(last?.preview || "Say hello")}</span></span><span class="rr">${last ? H.ago(last.ago) : ""}</span></button>`;
            })
            .join("") || '<div class="empty">No bots yet. Your first quick chat creates one.</div>'
        }</div></section>
      ${S.groups.length ? `<section><div class="sec-h"><h2>Group chats</h2></div><div class="rows">${S.groups.map((g) => `<button class="row" data-a="nav" data-id="${E(g.name)}"><span class="ri">${I("chat")}</span><span class="grow"><span class="rt" style="display:block">${E(g.name)}</span><span class="rm">${g.bots.map((id) => E(H.bot(id)?.name)).join(", ")}</span></span><span class="rr">${H.ago(g.ago)}</span></button>`).join("")}</div></section>` : ""}
      <section><div class="sec-h"><h2>Projects</h2></div>${
        projects
          .map(
            (p) =>
              `<div class="c5-proj"><div class="c5-proj-h">${I("folder", "sm")}<b class="grow ell">${E(p.name)}</b><span class="quiet small">${E(H.hostLabel(H.host(p.hostId)))}</span></div>${S.sessions
                .filter((s) => s.projectId === p.id)
                .map(sess)
                .join("")}</div>`,
          )
          .join("") || '<div class="empty">No projects yet.</div>'
      }</section>
      <button class="c5-fab" data-a="c5-tab" data-id="home" title="New chat">${I("pencil")}</button></div>`;
  }

  // ---------- Navigation: sidebar (desktop) and bottom tabs (mobile) ----------
  const TABS = [
    ["home", "home", "Home"],
    ["chat", "chat", "Chat"],
    ["inbox", "inbox", "Inbox"],
    ["schedules", "automation", "Schedules"],
    ["settings", "settings", "Settings"],
  ];
  const inboxCount = () => H.attention().filter((a) => a.kind !== "offline").length;
  const defaultNavTail = () =>
    `<button class="sb-item" data-a="nav" data-id="New workspace">${I("plus")}New workspace</button><button class="sb-item" data-a="nav" data-id="History">${I("history")}History</button>`;
  function sidebar(navTail = defaultNavTail()) {
    const S = H.S;
    const navItem = (id, icon, t, extra = "") =>
      `<button class="sb-item ${S.tab === id ? "on" : ""}" data-a="c5-tab" data-id="${id}">${I(icon)}<span class="grow">${t}</span>${extra}</button>`;
    const n = inboxCount();
    const iss = issues().length;
    const base = U.sidebar();
    // Keep the current sidebar's Chat sections and footer; put Home, Inbox and Schedules first.
    return base
      .replace(
        /<div class="sb-nav">[\s\S]*?<\/div>/,
        `<div class="sb-nav">${navItem("home", "home", "Home")}${navItem("inbox", "inbox", "Inbox", n ? `<span class="pill warn">${n}</span>` : "")}${navItem("schedules", "automation", "Schedules")}
        ${navTail}</div>`,
      )
      .replace(
        /<button class="sb-icon" data-a="sheet" data-sheet="hosts" title="Hosts">[\s\S]*?<\/button>/,
        `<button class="sb-icon" data-a="sheet" data-sheet="hosts" title="Hosts" style="position:relative">${I("server")}${iss ? '<span class="c5-badge"></span>' : ""}</button>`,
      )
      .replace(
        /<button class="sb-icon" data-a="nav" data-id="Settings" title="Settings">/,
        `<button class="sb-icon ${S.tab === "settings" ? "on" : ""}" data-a="c5-tab" data-id="settings" title="Settings">`,
      )
      .replace(
        /(<div class="sb-head">[\s\S]*?Bots[\s\S]*?)(<div class="sb-head">)/,
        `$1${S.groups.length ? `<div class="sb-head">${I("chat")}Group chats</div>${S.groups.map((g) => `<button class="sb-row" data-a="nav" data-id="${E(g.name)}"><span class="badge">${I("chat", "sm")}</span><span class="ell">${E(g.name)}</span></button>`).join("")}` : ""}$2`,
      );
  }
  const title = () => TABS.find(([id]) => id === H.S.tab)?.[2] || "Home";
  function header(ctx) {
    const iss = issues().length;
    const l = local() || H.S.hosts.find(isOn);
    if (H.compact)
      return `<header class="header"><span class="title">${title()}</span><span class="grow"></span>
      <button class="hbtn" data-a="sheet" data-sheet="hosts" title="Hosts">${I("server", "lg")}<span class="dot ${iss ? "warn" : l && isOn(l) ? "ok" : "off"}" style="position:absolute;right:6px;bottom:7px"></span></button></header>`;
    return `<header class="header"><button class="hbtn" data-a="nav" data-id="Toggle sidebar">${I("panel")}</button><span class="title">${title()}</span><span class="grow"></span>${ctx && iss ? `<button class="btn sm ghost" data-a="sheet" data-sheet="hosts">${I("alert", "sm")} ${iss} connection issue${iss > 1 ? "s" : ""}</button>` : ""}</header>`;
  }
  const tabbar = () =>
    `<nav class="c5-tabs">${TABS.map(([id, icon, t]) => `<button class="${H.S.tab === id ? "on" : ""}" data-a="c5-tab" data-id="${id}">${I(icon, "lg")}<span>${t}</span>${id === "inbox" && inboxCount() ? `<span class="count">${inboxCount()}</span>` : ""}</button>`).join("")}</nav>`;

  // ---------- Popovers ----------
  function hostPop(ctx) {
    const S = H.S;
    const q = S.hostq.trim().toLowerCase();
    const visible = S.hosts.filter((h) => h.status !== "unknown");
    const item = (h) =>
      `<button class="opt" data-a="${isOn(h) ? "pick-host" : "noop"}" data-id="${h.id}" ${isOn(h) ? "" : "disabled"}>${hostIcon(h)}<span class="grow"><span class="ell" style="display:block">${E(H.hostLabel(h))}</span><span class="od">${E(H.hostVia(h))}${isOn(h) ? "" : ` · ${E(h.status)}`}</span></span>${statusDot(h)}${ctx.host?.id === h.id ? I("check", "check") : ""}</button>`;
    let body;
    if (q) {
      const hits = visible.filter((h) =>
        `${h.name} ${H.hostLabel(h)} ${h.via}`.toLowerCase().includes(q),
      );
      body = `${hits.slice(0, 30).map(item).join("") || '<div class="quiet small" style="padding:8px">No host matches.</div>'}${hits.length > 30 ? `<div class="quiet small" style="padding:6px 8px">${hits.length - 30} more — keep typing</div>` : ""}`;
    } else {
      const recent = usedFirst(visible.filter((h) => h.usedAgo != null || H.isLocal(h))).slice(
        0,
        5,
      );
      body = `<div class="pop-h">Recent</div>${recent.map(item).join("")}${groups()
        .map(
          (g) =>
            `<hr><button class="opt" data-a="sheet" data-sheet="${g.hub?.status === "signin" ? `hub:${g.id}` : `browse:${g.id}`}">${I(g.hub?.managed ? "shield" : g.hub ? "globe" : "link", "sm")}<span class="grow">${E(g.title)}<span class="od" style="display:block">${g.hub?.status === "signin" ? "Sign in to see its hosts" : `${counts(g.hosts).on} of ${g.hosts.length} online · browse`}</span></span>${I("right", "sm")}</button>`,
        )
        .join("")}`;
    }
    return `<div style="padding:4px 4px 6px"><input class="c5-search" id="hostq" data-model="hostq" value="${E(S.hostq)}" placeholder="Search ${visible.length} hosts" aria-label="Search hosts"></div>${body}
      <hr><button class="opt" data-a="sheet" data-sheet="pair">${I("plus")}<span class="grow">Connect a computer</span></button><button class="opt" data-a="sheet" data-sheet="add-hub">${I("globe")}<span class="grow">Add a Hub</span></button>`;
  }
  function pop(kind, ctx) {
    if (kind === "host") return hostPop(ctx);
    if (kind === "c5-connect")
      return `<div class="pop-h">Connect</div>
      <button class="opt" data-a="sheet" data-sheet="pair">${I("monitor")}<span class="grow">Connect a computer<span class="od" style="display:block">Pairing link, QR, address or SSH</span></span></button>
      <button class="opt" data-a="sheet" data-sheet="add-hub">${I("globe")}<span class="grow">Add a Hub<span class="od" style="display:block">Your own Hub or your company's</span></span></button>
      <hr><button class="opt" data-a="sheet" data-sheet="help">${I("help")}<span class="grow">Fix a connection</span></button>`;
    if (kind === "c5-bots")
      return `<div class="pop-h">Chat with a bot</div>${H.S.bots.map((b) => `<button class="opt" data-a="pick-bot" data-id="${b.id}"><span class="pill" style="padding:0 5px">${E(b.initials)}</span><span class="grow">${E(b.name)}<span class="od" style="display:block">${E(H.hostLabel(H.host(b.hostId)))}</span></span>${ctx.target.botId === b.id ? I("check", "check") : ""}</button>`).join("") || '<div class="quiet small" style="padding:8px">No bots yet.</div>'}
      <hr><button class="opt" data-a="sheet" data-sheet="tpl:blank">${I("plus")}<span class="grow">Create bot</span></button>`;
    return "";
  }

  // ---------- Sheets ----------
  const shell = (t, body, foot = "") =>
    `<div class="sheet" role="dialog" aria-label="${E(t)}"><div class="sheet-h"><h3 class="grow">${t}</h3><button class="hbtn" data-a="close">${I("x")}</button></div><div class="sheet-b">${body}</div>${foot ? `<div class="sheet-f">${foot}</div>` : ""}</div>`;
  function browseSheet(id) {
    const S = H.S;
    const g = groups().find((x) => x.id === id);
    const q = S.browseq.trim().toLowerCase();
    const f = S.browseFilter;
    const list = usedFirst(g.hosts).filter(
      (h) => (!q || h.name.includes(q)) && (f === "all" || (f === "online" ? isOn(h) : !isOn(h))),
    );
    return shell(
      `${E(g.title)} · ${g.hosts.length} hosts`,
      `${g.hub?.managed ? `<div class="notice">${I("shield")}<div><b>Managed access.</b> ${E(g.title)} decides who can start sessions on these Hosts; each new session gets a Hub access ticket.</div></div>` : ""}
      <input class="c5-search" id="browseq" data-model="browseq" value="${E(S.browseq)}" placeholder="Search by name, e.g. gpu, staging, dev-">
      <span class="tabs">${[
        ["all", "All"],
        ["online", "Online"],
        ["offline", "Not online"],
      ]
        .map(
          ([k, t]) =>
            `<button class="${f === k ? "on" : ""}" data-a="c5-browse-filter" data-id="${k}">${t}</button>`,
        )
        .join("")}</span>
      <div class="c5-group">${list.slice(0, 60).map(hostRow).join("") || '<div class="c5-hrow quiet small">No host matches.</div>'}${list.length > 60 ? `<div class="c5-hrow quiet small">${list.length - 60} more · refine the search</div>` : ""}</div>`,
    );
  }
  function fixSheet(id) {
    const h = H.host(id);
    const managed = h.managed;
    const step = (ok, t, d) =>
      `<div class="step ${ok === true ? "done" : ok === false ? "now" : ""}"><span class="n">${ok === true ? I("check", "sm") : ok === false ? "!" : "·"}</span><div class="grow"><div class="st">${t}</div>${d ? `<div class="sd">${d}</div>` : ""}</div></div>`;
    return shell(
      `Fix connection · ${E(H.hostLabel(h))}`,
      `<div class="setup"><div class="setup-steps">
        ${step(true, "This device is online", "")}
        ${step(true, `${E(h.via)} is reachable`, "")}
        ${step(false, `${E(h.name)} didn't answer`, `Last seen ${E(h.lastSeen || "—")}. Checked ${managed ? "through the Hub" : `${E(h.name.toLowerCase().replace(/\s+/g, "-"))}.tailnet.ts.net:6767`}.`)}
        ${step(true, "Versions are compatible", `Host ${E(h.version)} · app 0.11.1`)}</div></div>
      <div><b>Most likely</b><ul class="c5-ul"><li>The computer is asleep or turned off.</li><li>Clisbot stopped there. On that computer run <code>clisbot daemon status</code>, or open the desktop app.</li>${managed ? "<li>The Hub admin took it offline for maintenance.</li>" : "<li>Tailscale is signed out on one side.</li>"}</ul></div>
      <p class="quiet small" style="margin:0">Sessions and schedules on ${E(h.name)} stay there and continue when it's back.</p>`,
      `<button class="btn ghost" data-a="sheet" data-sheet="help">Help</button><span class="grow"></span>${managed ? "" : '<button class="btn" data-a="sheet" data-sheet="pair">Pair again</button>'}<button class="btn solid" data-a="c5-retry" data-id="${h.id}">${I("refresh", "sm")} Try again</button>`,
    );
  }
  function hubSheet(id) {
    const x = hub(id);
    const hosts = H.S.hosts.filter((h) => h.hubId === id);
    return shell(
      `${E(x.name)} Hub`,
      `<dl class="kv"><dt>Kind</dt><dd>${E(x.kind)} Hub</dd><dt>Address</dt><dd>${E(x.url)}</dd><dt>You are</dt><dd>${E(x.role)}</dd><dt>Hosts</dt><dd>${x.status === "signin" ? `${hosts.length} · hidden until you sign in` : `${counts(hosts).on} of ${hosts.length} online`}</dd>${x.managed ? "<dt>Access</dt><dd>Managed access: the Hub grants each session</dd>" : ""}</dl>
      ${x.status === "signin" ? `<div class="notice warn">${I("lock")}<div>Your sign-in expired. Sign in again to see and use its Hosts. Nothing on those Hosts stopped.</div></div>` : ""}`,
      `<button class="btn ghost" data-a="nav" data-id="Remove Hub">Remove</button><span class="grow"></span>${x.status === "signin" ? `<button class="btn solid" data-a="c5-signin" data-id="${x.id}">Sign in again</button>` : `<button class="btn" data-a="sheet" data-sheet="browse:${x.id}">Browse hosts</button>`}`,
    );
  }
  const addHubSheet = () =>
    shell(
      "Add a Hub",
      `<p class="muted" style="margin:0">A Hub shares Hosts with you: your own machines, or your company's build and dev servers. Signing in adds them here; nothing is installed on this device.</p>
      <div class="field"><label>Hub address</label><input value="hub.vexere.com"></div>
      <button class="btn">${I("globe", "sm")} Continue with Google</button>
      <p class="quiet small" style="margin:0">Your company may let anyone with a work email join, or send you an invitation.</p>`,
      `<button class="btn" data-a="close">Cancel</button><button class="btn solid" data-a="c5-add-hub">Continue</button>`,
    );
  const helpSheet = () =>
    shell(
      "Connection help",
      `${issues()
        .map(
          (it) =>
            `<div class="c5-issue">${I("alert", "sm")}<span class="grow"><b>${E(it.title)}</b></span>${fixBtn(it)}</div>`,
        )
        .join("")}
      <div class="rows">${[
        [
          "A host shows Offline",
          "Wake the computer, open Clisbot there or run clisbot daemon status, then Try again.",
        ],
        [
          "Web can't find this computer",
          "Open the desktop app, or allow Local network access in the browser's site settings.",
        ],
        [
          "The phone can't connect",
          "On the computer: Settings → your host → Pair Device, then scan the new QR code.",
        ],
        ["A Hub asks to sign in", "Sign-ins expire. Sign in again; nothing on its Hosts stopped."],
        [
          "A company host refuses a session",
          "Managed access: ask your Hub admin for access to that Host or Project.",
        ],
      ]
        .map(
          ([t, d]) =>
            `<div class="row" style="cursor:default"><span class="ri">${I("info")}</span><span class="grow"><span class="rt" style="display:block">${t}</span><span class="rm">${d}</span></span></div>`,
        )
        .join("")}</div>`,
      `<button class="btn" data-a="nav" data-id="Docs">${I("external", "sm")} Open docs</button>`,
    );
  function tplSheet(id) {
    const t = BOT_TPL.find((x) => x.id === id) || {
      id: "blank",
      name: "New bot",
      text: "A teammate with its own folder and instructions.",
      adds: "Bot",
    };
    const ctx = H.resolve();
    const h = ctx.host || H.S.hosts.find(isOn);
    return shell(
      id === "blank" ? "Create bot" : E(t.name),
      `<p class="muted" style="margin:0">${E(t.text)}</p>
      <div class="field"><label>Name</label><input value="${E(id === "blank" ? "My bot" : t.name.replace(/ bot$/, ""))}"></div>
      <dl class="kv"><dt>Runs on</dt><dd>${h ? E(H.hostLabel(h)) : "Connect a computer first"}</dd><dt>Agent</dt><dd>${E(H.providers[H.readyProviders(h)[0] || "claude"].name)} · Default permissions</dd><dt>Adds</dt><dd>${E(t.adds)}</dd><dt>Folder</dt><dd>~/.clisbot/bots/${E(id === "blank" ? "my-bot" : t.id)}</dd></dl>`,
      `<button class="btn" data-a="close">Cancel</button><button class="btn solid" data-a="c5-create-bot" data-id="${t.id}" ${h ? "" : "disabled"}>Create and chat</button>`,
    );
  }
  function hostsSheet() {
    return shell(
      "Hosts",
      `${issues()
        .map(
          (it) =>
            `<div class="c5-issue">${I("alert", "sm")}<span class="grow"><b>${E(it.title)}</b> <span class="quiet">· ${E(it.text)}</span></span>${fixBtn(it)}</div>`,
        )
        .join("")}
      <div class="c5-groups">${local() ? `<div class="c5-group">${hostRow(local())}</div>` : ""}${
        groups()
          .map((g) => groupBlock(g))
          .join("") || '<div class="empty">No computers connected yet.</div>'
      }</div>`,
      `<button class="btn" data-a="sheet" data-sheet="add-hub">${I("globe", "sm")} Add a Hub</button><button class="btn solid" data-a="sheet" data-sheet="pair">${I("plus", "sm")} Connect a computer</button>`,
    );
  }
  // ---------- One Host: its agents, status and the ways to fix or set it up ----------
  const MODELS = { claude: 18, codex: 7, opencode: 604, copilot: 12 };
  const SIGNIN = {
    claude: "claude /login",
    codex: "codex login",
    opencode: "opencode auth login",
    copilot: "gh auth login",
  };
  const INSTALL = {
    claude: "npm install -g @anthropic-ai/claude-code",
    codex: "npm install -g @openai/codex",
    opencode: "npm install -g opencode-ai",
    copilot: "gh extension install github/gh-copilot",
  };
  const provState = (st) =>
    st === "ready" ? "Ready" : st === "signin" ? "Not signed in" : "Not installed";
  const provRow = (h, id) => {
    const st = h.providers[id];
    const action =
      st === "ready"
        ? '<span class="pill ok">Ready</span>'
        : `<button class="btn sm ${st === "signin" ? "solid" : ""}" data-a="sheet" data-sheet="prov:${h.id}~${id}">${st === "signin" ? "Sign in" : "Install"}</button>`;
    return `<div class="c5-hrow">${H.pv(id)}<span class="grow">${H.providers[id].name}<span class="rm" style="display:block">${st === "ready" ? `${MODELS[id]} models · ${H.providers[id].model}` : provState(st)}</span></span>${action}</div>`;
  };
  function hostSheet(id) {
    const h = H.host(id);
    const on = isOn(h);
    const x = h.hubId && hub(h.hubId);
    const ss = H.S.sessions.filter((t) => t.hostId === id);
    const next = H.upcoming().find((k) => k.hostId === id && !k.paused);
    const ids = Object.keys(h.providers);
    const ready = H.readyProviders(h).length;
    const row = (icon, t, d, a, extra = "") =>
      `<button class="c5-set" data-a="${a}" ${extra}>${I(icon, "sm")}<span class="grow">${t}<span class="rm">${d}</span></span>${I("right", "sm")}</button>`;
    const body = `<div class="c5-hstat">${statusDot(h)}<b>${on ? "Online" : h.status === "offline" ? "Offline" : E(h.status)}</b><span class="quiet">· ${x ? `via ${E(x.name)} Hub` : E(H.hostVia(h))} · Clisbot ${E(h.version)}${h.managed ? " · Managed access" : ""}</span></div>
      ${on ? "" : `<div class="notice warn">${I("offline")}<div class="grow">Last seen ${E(h.lastSeen || "—")}. Sessions and schedules here wait for it.<div class="acts"><button class="btn sm" data-a="sheet" data-sheet="fix:${h.id}">Troubleshoot</button></div></div></div>`}
      <section><div class="sec-h"><h2>Agents</h2><span class="sub">${ready} of ${ids.length} ready</span><div class="right"><button class="btn ghost sm" data-a="nav" data-id="Manage providers">Manage providers ${I("right", "sm")}</button></div></div>
        <div class="c5-group">${ids.map((pid) => provRow(h, pid)).join("")}</div>
        ${h.managed ? '<p class="quiet small" style="margin:6px 0 0">This Hub manages the agents on its Hosts; ask its admin to add one.</p>' : ""}</section>
      <section><div class="sec-h"><h2>Activity</h2></div><div class="quiet">${ss.length ? `${ss.filter((t) => t.status === "running").length} running · ${ss.filter((t) => t.status === "needs").length} need you · ${ss.length} sessions` : "No sessions yet"}${next ? `<br>Next run: ${E(next.name)} · ${E(next.day)} ${E(next.at)}` : ""}</div></section>
      <section><div class="rows">${row("settings", "Host settings", "Name, connections, folders, limits", "nav", 'data-id="Host settings"')}${row("alert", "Troubleshoot connection", "Check each step and the usual causes", "sheet", `data-sheet="fix:${h.id}"`)}${H.isLocal(h) ? row("phone", "Pair a phone", "Show a QR code for this Host", "sheet", 'data-sheet="pair"') : ""}${row("notes", "Logs", "daemon.log on this Host", "nav", 'data-id="Logs"')}</div></section>`;
    return shell(
      `${E(H.hostLabel(h))}${H.isLocal(h) ? ` <span class="quiet small">${E(h.name)}</span>` : ""}`,
      body,
      on
        ? `<button class="btn" data-a="close">Close</button><button class="btn solid" data-a="c5-use-host" data-id="${h.id}">Use for new messages</button>`
        : `<button class="btn solid" data-a="c5-retry" data-id="${h.id}">${I("refresh", "sm")} Try again</button>`,
    );
  }
  function provSheet(key) {
    const [hid, pid] = key.split("~");
    const h = H.host(hid);
    const st = h.providers[pid];
    const name = H.providers[pid].name;
    const waiting = H.S.provBusy === key;
    const signin = st === "signin";
    const body = `<p class="muted" style="margin:0">${signin ? `${E(name)} is installed on ${E(H.hostLabel(h))} but not signed in.` : `${E(name)} is not installed on ${E(H.hostLabel(h))}.`}</p>
      <div class="setup"><div class="setup-steps">
        <div class="step now"><span class="n">1</span><div class="grow"><div class="st">${signin ? "Clisbot opens a terminal on that Host and runs" : "Clisbot runs on that Host"}</div><div class="cmd" style="margin-top:6px"><span>${E(signin ? SIGNIN[pid] : INSTALL[pid])}</span><button class="btn sm ghost" data-a="copy">${I("copy", "sm")}</button></div></div></div>
        <div class="step"><span class="n">2</span><div class="grow"><div class="st">${signin ? "Finish in the browser it opens" : "Then sign in when it asks"}</div></div></div>
        <div class="step"><span class="n">3</span><div class="grow"><div class="st">Clisbot checks again and lists its models</div></div></div></div></div>
      ${h.managed ? '<div class="notice">' + I("shield") + "<div>Managed by the Hub. Ask your Hub admin to set this agent up.</div></div>" : ""}`;
    return shell(
      `${signin ? "Sign in to" : "Install"} ${E(name)}`,
      body,
      `<button class="btn" data-a="sheet" data-sheet="host:${hid}">Back</button><span class="grow"></span>
      <button class="btn solid" data-a="prov-run" data-id="${key}" ${waiting || h.managed || !isOn(h) ? "disabled" : ""}>${waiting ? `${I("loader", "sm spin")} Waiting…` : signin ? "Open terminal and sign in" : "Install on this Host"}</button>`,
    );
  }
  function sheet(kind, id) {
    return (
      {
        host: () => hostSheet(id),
        prov: () => provSheet(id),
        browse: () => browseSheet(id),
        fix: () => fixSheet(id),
        hub: () => hubSheet(id),
        "add-hub": addHubSheet,
        help: helpSheet,
        tpl: () => tplSheet(id),
        hosts: hostsSheet,
      }[kind]?.() || ""
    );
  }

  // ---------- Actions ----------
  const A = H.actions;
  Object.assign(A, {
    "prov-run"(el) {
      const key = el.dataset.id;
      const [hid, pid] = key.split("~");
      H.S.provBusy = key;
      H.later(1200, () => {
        H.host(hid).providers[pid] = "ready";
        H.S.provBusy = null;
        H.S.sheet = `host:${hid}`;
        H.toast(`${H.providers[pid].name} is ready on ${H.hostLabel(H.host(hid))}`);
      });
    },
    "c5-tab"(el) {
      const S = H.S;
      S.tab = el.dataset.id;
      S.pop = null;
      S.sheet = null;
      if (S.tab === "home") requestAnimationFrame(() => document.getElementById("draft")?.focus());
    },
    "c5-quick"() {
      const S = H.S;
      S.pop = null;
      if (H.bot("personal")) {
        S.target = { kind: "bot", botId: "personal" };
        return;
      }
      const ctx = H.resolve();
      const h =
        ctx.reason === "bot"
          ? H.S.hosts.find((x) => H.isLocal(x) && isOn(x)) || ctx.host
          : ctx.host;
      if (h) S.pick = { hostId: h.id, projectId: null };
      S.target = { kind: "starter" };
    },
    "c5-project"() {
      const S = H.S;
      const ctx = H.resolve();
      if (ctx.target.kind !== "agent") {
        const h = ctx.reason === "bot" || !ctx.host ? S.hosts.find(isOn) : ctx.host;
        if (h)
          S.pick = {
            hostId: h.id,
            projectId:
              S.memory.byHost[h.id] && H.project(S.memory.byHost[h.id])
                ? S.memory.byHost[h.id]
                : H.projectsOn(h.id)[0]?.id || null,
          };
        S.target = { kind: "agent", provider: (h && H.readyProviders(h)[0]) || "claude" };
      }
      S.pop = { kind: "project", anchor: "project" };
    },
    "c5-prompt"(el) {
      A["c5-quick"]();
      A.starter(el);
    },
    "c5-proj-tpl"(el) {
      const t = PROJ_TPL.find((x) => x.id === el.dataset.id);
      A["c5-project"]();
      H.S.pop = H.resolve().project ? null : { kind: "project", anchor: "project" };
      H.S.draft = t.text;
    },
    "c5-use-host"(el) {
      A["pick-host"](el);
      H.S.sheet = null;
      H.S.tab = "home";
      H.toast(`New messages run on ${H.hostLabel(H.host(el.dataset.id))}`);
    },
    "c5-browse-filter"(el) {
      H.S.browseFilter = el.dataset.id;
    },
    "c5-retry"(el) {
      H.S.sheet = null;
      H.reconnect(el.dataset.id);
    },
    "c5-signin"(el) {
      const x = hub(el.dataset.id);
      x.status = "online";
      H.S.hosts
        .filter((h) => h.hubId === x.id)
        .forEach((h) => {
          h.status = "online";
        });
      H.S.sheet = null;
      H.toast(`Signed in to ${x.name} Hub`);
    },
    "c5-add-hub"() {
      const S = H.S;
      S.sheet = null;
      if (hub("vexere")) {
        H.toast("Vexere Hub is already added");
        return;
      }
      S.hubs.push({ ...HUBS.vexere, status: "online", total: 124 });
      S.hosts.push(...companyHosts());
      S.projects.push({
        id: "dev-long-web",
        hostId: "vx-dev-long",
        name: "vexere-web",
        path: "~/work/vexere-web",
        usedAgo: 600,
      });
      if (S.local !== "ready") S.local = "none";
      H.toast("Added Vexere Hub · 124 hosts shared with you");
    },
    "c5-create-bot"(el) {
      const S = H.S;
      const t = BOT_TPL.find((x) => x.id === el.dataset.id);
      const h = H.resolve().host || S.hosts.find(isOn);
      const id = `bot-${el.dataset.id}-${S.bots.length}`;
      const name = t ? t.name.replace(/ bot$/, "") : "My bot";
      S.projects.push({
        id: `${id}-home`,
        hostId: h.id,
        name,
        path: `~/.clisbot/bots/${id}`,
        usedAgo: 0,
        botHome: true,
      });
      S.bots.push({
        id,
        name,
        initials: name
          .split(/\s+/)
          .map((w) => w[0])
          .join("")
          .slice(0, 2)
          .toUpperCase(),
        hostId: h.id,
        projectId: `${id}-home`,
        provider: H.readyProviders(h)[0] || "claude",
      });
      if (t?.id === "standup")
        S.schedules.push({
          id: `k-${id}`,
          kind: "Schedule",
          name: "Daily standup",
          target: name,
          projectId: `${id}-home`,
          hostId: h.id,
          at: "09:00",
          day: "Mon",
          inMin: 3940,
          cadence: "Weekdays at 09:00",
          runIn: "The bot's chat",
        });
      S.target = { kind: "bot", botId: id };
      S.sheet = null;
      S.tab = "home";
      H.toast(`Created ${name}${t?.id === "standup" ? " and its weekday schedule" : ""}`);
    },
    "pick-bot-chat"(el) {
      H.S.target = { kind: "bot", botId: el.dataset.id };
      H.S.tab = "home";
    },
  });

  // Option 06 builds on these parts.
  H.c5 = {
    hub,
    local,
    usedFirst,
    statusDot,
    hostIcon,
    counts,
    isOn,
    provState,
    seedHubs,
    groups,
    issues,
    hostBar,
    hostPop,
    pop,
    sheet,
    sidebar,
    header,
    tabbar,
    inboxSection,
    schedulesSection,
    hostsSection,
    inboxPage,
    schedulesPage,
    settingsPage,
    chatPage,
    PROMPTS,
    BOT_TPL,
    PROJ_TPL,
  };
  H.concept = {
    num: 5,
    name: "App",
    tagline: "05 · App — điều hướng chuẩn, Host/Hub ở đầu Home",
    onSeed: seedHubs,
    sidebar: () => sidebar(),
    header: (ctx) => header(ctx),
    pop,
    sheet,
    reviewExtra: () =>
      `<label>Hub <select data-change="hub">${[
        ["none", "Không có Hub"],
        ["one", "1 Hub cá nhân"],
        ["many", "3 Hub · có Hub công ty 124 host"],
      ]
        .map(([v, t]) => `<option value="${v}" ${H.S.hub === v ? "selected" : ""}>${t}</option>`)
        .join("")}</select></label>`,
    render: (ctx) =>
      (
        ({
          home,
          chat: chatPage,
          inbox: inboxPage,
          schedules: schedulesPage,
          settings: settingsPage,
        })[H.S.tab] || home
      )(ctx),
    bottom: () => (H.compact ? tabbar() : ""),
    notes: `<h2>05 · App — điều hướng chuẩn + Host/Hub</h2>
      <p><b>Ý tưởng:</b> Home là một tab trong điều hướng chuẩn của app, không phải màn hình riêng lẻ. Mobile có 5 tab dưới: <b>Home · Chat · Inbox · Schedules · Settings</b>. Desktop giữ sidebar hiện tại: Home, Inbox, Schedules ở đầu; phần Bots / Group chats / Projects của sidebar <b>chính là tab Chat</b>; Settings ở icon cuối sidebar.</p>
      <h3>Home, từ trên xuống</h3><ol style="padding-left:18px">
      <li><b>Hosts</b>: một dòng tóm tắt (“121 of 128 hosts online · 3 Hubs”), chip cho máy này và từng Hub (số online/tổng, hoặc “Sign in”), nút Connect (Connect a computer / Add a Hub / Fix a connection) và Help. Có sự cố thì hiện ngay dưới với nút Fix hoặc Sign in.</li>
      <li><b>Chat</b>: chọn <b>Quick chat</b> (không cần Project — tin đầu tạo Personal assistant), <b>Bot</b>, hoặc <b>Project</b>; dòng Runs on Host › Project; composer.</li>
      <li><b>Templates</b> ba nhóm: <i>Just ask</i> (không cần Bot/Project), <i>Comes with a bot</i> (tạo Bot, có thể kèm lịch hoặc connector), <i>Works in a project</i> (cần Project). Nút <b>Create bot</b>.</li>
      <li>Dưới: <b>Inbox</b> (việc cần bạn + cập nhật) | <b>Schedules</b> sắp chạy và <b>Hosts</b> theo nhóm (máy này, Direct, từng Hub) kèm Connect a computer, Add a Hub, Connection help.</li></ol>
      <h3>Hub: 0, 1, nhiều, và Hub công ty 124 host</h3><ul>
      <li><b>Không Hub</b>: máy này + các máy ghép nối trực tiếp (Relay/Tailscale).</li>
      <li><b>1 Hub</b>: các Host đến từ Hub cá nhân; vẫn hiện máy này riêng ở đầu.</li>
      <li><b>Nhiều Hub</b>: Hub cá nhân, Hub công ty Vexere (124 host, Managed access, biểu tượng khiên) và một Hub hết phiên đăng nhập. Không bao giờ liệt kê 124 host trên Home: mỗi Hub hiện tối đa 3 host <b>bạn đã dùng</b>, còn lại qua <b>Browse all 124 hosts</b> (tìm kiếm, lọc Online/Not online).</li>
      <li>Bộ chọn Host có ô tìm kiếm, nhóm <b>Recent</b> rồi từng Hub. Gõ “gpu” ra ngay các máy GPU.</li>
      <li>Sự cố chỉ tính những gì bạn xử lý được: Host bạn dùng bị offline, Hub cần đăng nhập lại, Hub không tới được. 4 máy công ty offline mà bạn chưa từng dùng không làm Home báo động.</li>
      <li><b>Fix connection</b>: kiểm tra từng bước (thiết bị online → mạng/Hub tới được → Host không trả lời → phiên bản tương thích), nguyên nhân hay gặp, Try again / Pair again / Help. Session và lịch trên Host đó ở yên chỗ cũ.</li>
      <li>Lần đầu trên web/mobile có thêm lối <b>“Using Clisbot at work? Add a Hub”</b>: người dùng công ty không cần ghép nối máy, đăng nhập Hub là thấy Host được chia sẻ (thêm Hub xong tự chọn Host bạn dùng gần nhất trên Hub đó, kể cả từ thiết bị khác).</li></ul>
      <h3>Các tab khác</h3><ul><li><b>Chat</b> (mobile): nội dung sidebar hiện tại — Bots, Group chats, Projects và session; nút viết mới về Home.</li><li><b>Inbox</b>: Needs you (Approve/Retry/Reconnect) + Updates. Badge số trên tab.</li><li><b>Schedules</b>: Today / Later / Paused, New schedule.</li><li><b>Settings</b>: Hosts &amp; Hubs (quản lý, đăng nhập lại, xem chi tiết), App, Help &amp; support.</li></ul>
      <h3>Đánh đổi</h3><ul><li>Thêm một tầng điều hướng so với 04; bù lại người dùng nhiều Hub/Host có chỗ quản lý rõ ràng.</li><li>Cần dữ liệu “host bạn đã dùng” theo người dùng để Hub lớn không thành danh sách dài.</li><li>Home trên mobile dài hơn; phần dưới chỉ là tóm tắt, chi tiết nằm ở tab riêng.</li></ul>`,
  };
})();
