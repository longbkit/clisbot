/* oxlint-disable no-nested-ternary, complexity -- prototype view templates read as one expression per state. */
/* 06 · Home = New workspace + overview. The start block is today's New workspace screen (context row,
   composer, Import session) with the Host first and "No project" and Bots in the Project picker.
   Navigation, Host health and Hubs come from 05. */
(() => {
  const { icon: I, esc: E, ui: U } = H;
  const C5 = H.c5;

  // ---------- Avatars: a Bot is a round badge, a Project a square, a plain prompt an icon ----------
  const TINTS = ["#5b6bb5", "#3e8e7e", "#b0763a", "#8a5bb5", "#4f7fa8"];
  const tint = (s) => TINTS[[...s].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length];
  const botAv = (b) =>
    `<span class="c6-av bot" style="background:${tint(b.name)}">${E(b.initials)}</span>`;
  const projAv = (p) => `<span class="c6-av proj">${E(p.name[0].toUpperCase())}</span>`;
  const iconAv = (name) => `<span class="c6-av icon">${I(name, "sm")}</span>`;

  // ---------- Hosts strip: status at a glance, not a card ----------
  // This computer, the Hosts you used (or a small Hub's Hosts), then one entry per large Hub.
  function stripEntries() {
    const S = H.S;
    const l = C5.local();
    const small = (h) => S.hub === "none" || h.hubId === "personal";
    const used = C5.usedFirst(
      S.hosts.filter(
        (h) => !H.isLocal(h) && h.status !== "unknown" && (small(h) || h.usedAgo != null),
      ),
    ).slice(0, 3);
    const hosts = [...(l ? [l] : []), ...used].map((h) => ({
      kind: "host",
      h,
    }));
    const hubs = S.hubs.filter((x) => x.id !== "personal").map((x) => ({ kind: "hub", x }));
    return [...hosts, ...hubs];
  }
  const hostSub = (h) =>
    C5.isOn(h)
      ? `${H.readyProviders(h).length} agents ready`
      : h.status === "offline"
        ? "Offline"
        : E(h.status);
  const hubSub = (x) => {
    const hs = H.S.hosts.filter((h) => h.hubId === x.id);
    return x.status === "signin"
      ? "Sign in"
      : x.status === "unreachable"
        ? "Unreachable"
        : `${C5.counts(hs).on}/${hs.length} online`;
  };
  function entry(e) {
    if (e.kind === "host") {
      const h = e.h;
      return `<button class="c6-h ${C5.isOn(h) ? "" : "off"}" data-a="sheet" data-sheet="host:${h.id}" title="Agents, status and settings"><span class="c6-h-ic">${C5.hostIcon(h)}${C5.statusDot(h)}</span><span class="c6-h-t"><span class="ell">${E(H.hostLabel(h))}</span><span class="c6-h-s">${hostSub(h)}</span></span></button>`;
    }
    const x = e.x;
    return `<button class="c6-h ${x.status !== "online" ? "warn" : ""}" data-a="sheet" data-sheet="${x.status === "online" ? `browse:${x.id}` : `hub:${x.id}`}"><span class="c6-h-ic">${I(x.managed ? "shield" : "globe", "sm")}</span><span class="c6-h-t"><span class="ell">${E(x.name)}</span><span class="c6-h-s">${hubSub(x)}</span></span></button>`;
  }
  function hostStrip(ctx) {
    const S = H.S;
    const all = S.hosts.filter((h) => h.status !== "unknown");
    const summary = all.length
      ? `${C5.counts(all).on} of ${all.length} online`
      : ctx.blocker
        ? U.why(ctx)
        : "No computer yet";
    const issues = C5.issues();
    return `<section class="c6-hosts">
      <div class="c6-hosts-h"><span class="c6-hosts-label">Hosts</span><span class="quiet small">${E(summary)}</span><span class="grow"></span>
        <button class="btn ghost sm" data-a="pop" data-pop="c5-connect" data-anchor="c5-connect">${I("plus", "sm")} Connect</button>
        <button class="hbtn" data-a="sheet" data-sheet="help" title="Connection help">${I("help")}</button></div>
      ${all.length || S.hubs.length ? `<div class="c6-hosts-list">${stripEntries().map(entry).join("")}</div>` : ""}
      ${issues.length ? `<button class="c6-connection-summary" data-a="sheet" data-sheet="hosts">${I("alert", "sm")}<span>${issues.length} connection${issues.length === 1 ? "" : "s"} need${issues.length === 1 ? "s" : ""} attention</span><span class="c6-connection-link">View details ${I("right", "sm")}</span></button>` : ""}
    </section>`;
  }

  // ---------- Context row: Host · Project · Isolation ……… Launch (the New workspace row) ----------
  const projectLabel = (ctx) => {
    if (ctx.target.kind === "bot")
      return `${botAv(H.bot(ctx.target.botId))}<span class="ell">${E(H.bot(ctx.target.botId).name)}</span>`;
    if (ctx.target.kind === "starter" || !ctx.project || ctx.project.scratch)
      return `${I("chat", "sm")}<span class="ell">Quick chat<span class="c6-desktop-label"> - no project</span></span>`;
    return `${projAv(ctx.project)}<span class="ell">${E(ctx.project.name)}</span>`;
  };
  function ctxRow(ctx) {
    const S = H.S;
    const agent = ctx.target.kind === "agent" && ctx.project && !ctx.project.scratch;
    const terminal = S.launch === "Terminal";
    return `<div class="c6-row">
      ${U.hostChip(ctx, "c6-chip host")}
      <button class="c6-chip c6-target-chip" data-a="c6-open-picker" data-anchor="c6-project" ${ctx.host ? "" : "disabled"}>${projectLabel(ctx)}${I("down", "sm")}</button>
      ${agent ? `<button class="c6-chip" data-a="pop" data-pop="c6-iso" data-anchor="c6-iso">${I(S.isolation === "New worktree" ? "branch" : "folder", "sm")}${E(S.isolation || "Local")}${I("down", "sm")}</button>` : ""}
      <span class="grow"></span>
      ${agent ? `<button class="c6-chip" data-a="pop" data-pop="c6-launch" data-anchor="c6-launch">${I(terminal ? "terminal" : "chat", "sm")}${terminal ? "Terminal" : "Chat"}${I("down", "sm")}</button>` : ""}
    </div>`;
  }
  const composer = (ctx, rows) =>
    U.composer(ctx, {
      rows,
      placeholder:
        H.S.launch === "Terminal" && ctx.target.kind === "agent"
          ? "Run a command, or leave empty for a blank terminal"
          : undefined,
    });
  // What the chosen Host can run: its agents as icons, how many are ready, and the next step for the rest.
  function hostBrief(ctx, { compact = false } = {}) {
    const h = ctx.host;
    if (!h || !C5.isOn(h)) return "";
    const ids = Object.keys(h.providers);
    const by = (st) => ids.filter((p) => h.providers[p] === st);
    const [ready, signin, missing] = [by("ready"), by("signin"), by("missing")];
    return `<div class="c6-brief ${ready.length ? "" : "warn"} ${compact ? "compact" : ""}">
      <div class="c6-provider-summary"><span class="c6-pvs" aria-hidden="true">${[...ready, ...signin, ...missing].map((p) => `<span class="c6-pv ${h.providers[p]}">${H.pv(p)}</span>`).join("")}</span>
      <span class="c6-brief-n"><b>${ready.length}</b>/40+ agents ready</span></div>
      <button class="c6-brief-more" data-a="sheet" data-sheet="host:${h.id}">Status &amp; Setup ${I("right", "sm")}</button>
    </div>`;
  }

  // ---------- Saved quick starts: target + prompt, with independent Home pinning ----------
  const pinIcon = () =>
    `<svg class="icon sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3 21 8l-4 1-3 5v4l-8-8h4l5-3zM9 15l-6 6"/></svg>`;
  const quickKey = () =>
    `clisbot-home-06-quick-starts-v2:${H.S.scenario}:${H.compact ? "mobile" : "desktop"}`;
  function targetInfo(kind, id) {
    const obj = kind === "bot" ? H.bot(id) : kind === "project" ? H.project(id) : null;
    return obj
      ? {
          av: kind === "bot" ? botAv(obj) : projAv(obj),
          name: obj.name,
          sub: `${obj.name} · ${H.hostLabel(H.host(obj.hostId))}`,
          hostId: obj.hostId,
        }
      : {
          av: iconAv("chat"),
          name: "Quick chat - no project",
          sub: "Quick chat - no project",
        };
  }
  function quickItems() {
    const key = quickKey();
    if (H.S.quickKey === key) return H.S.quickStarts;
    const projects = H.S.projects
      .filter((p) => !p.botHome && !p.scratch && H.online(H.host(p.hostId)))
      .sort((a, b) => a.usedAgo - b.usedAgo);
    const bots = H.S.bots;
    const make = (id, kind, targetId, title, prompt) => ({
      id,
      kind,
      targetId,
      title,
      prompt,
    });
    const defaults = [
      bots[0] &&
        make(
          "bot-backlog",
          "bot",
          bots[0].id,
          "Prioritize my backlog",
          "Review the product backlog, suggest the top priorities and explain the tradeoffs.",
        ),
      projects[0] &&
        make(
          "project-tests",
          "project",
          projects[0].id,
          "Fix failing tests",
          "Run the test suite, find the failing tests and fix them.",
        ),
      make("quick-email", "quick", "", "Draft an email", C5.PROMPTS[0][1]),
      projects[1] &&
        make(
          "project-review",
          "project",
          projects[1].id,
          "Review my changes",
          "Review my uncommitted changes and point out risks.",
        ),
      bots[1] &&
        make(
          "bot-health",
          "bot",
          bots[1].id,
          "Check service health",
          "Check service health and recent alerts. Summarize what needs my attention.",
        ),
      make("quick-plan", "quick", "", "Plan my week", C5.PROMPTS[1][1]),
      ...C5.PROMPTS.slice(2).map(([title, prompt], i) =>
        make(`quick-${i}`, "quick", "", title, prompt),
      ),
      ...projects
        .slice(0, 3)
        .map((p) =>
          make(
            `tour-${p.id}`,
            "project",
            p.id,
            `Explain ${p.name}`,
            "Give me a tour of this project: structure, entry points, how to run it.",
          ),
        ),
    ]
      .filter(Boolean)
      .map((q, i) => ({ ...q, pinned: i < (H.compact ? 4 : 6) }));
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(key));
    } catch {}
    H.S.quickStarts = Array.isArray(saved)
      ? saved.filter(
          (q) =>
            q &&
            typeof q.id === "string" &&
            typeof q.title === "string" &&
            typeof q.prompt === "string" &&
            (q.kind === "quick" ||
              (q.kind === "bot"
                ? H.bot(q.targetId)
                : q.kind === "project" && H.project(q.targetId))),
        )
      : defaults;
    H.S.quickKey = key;
    return H.S.quickStarts;
  }
  function saveQuickStarts() {
    try {
      localStorage.setItem(quickKey(), JSON.stringify(H.S.quickStarts));
    } catch {}
  }
  const quickBtn = (q) => {
    const t = targetInfo(q.kind, q.targetId);
    return `<button class="c6-q" data-a="c6-use-quick" data-id="${E(q.id)}" title="${E(q.title)}">${t.av}<span class="c6-q-t"><span class="c6-q-title">${E(q.title)}</span><span class="c6-q-s ell">${E(t.name)}</span></span></button>`;
  };
  function quickStart() {
    const pinned = quickItems().filter((q) => q.pinned);
    return `<section class="c6-quick"><div class="sec-h"><h2>Quick start</h2><div class="right"><button class="btn ghost sm" data-a="c6-library">View all ${I("right", "sm")}</button></div></div>
      ${pinned.length ? `<div class="c6-qgrid">${pinned.map(quickBtn).join("")}</div>` : `<button class="c6-empty-pins" data-a="c6-library">${pinIcon()} Pin quick starts to show them here</button>`}</section>`;
  }
  function quickAllSheet() {
    const query = (H.S.quickQuery || "").toLowerCase().trim();
    const items = quickItems().filter((q) =>
      `${q.title} ${q.prompt} ${targetInfo(q.kind, q.targetId).sub}`.toLowerCase().includes(query),
    );
    const row = (q) => {
      const t = targetInfo(q.kind, q.targetId);
      return `<div class="c6-library-row">
        <button class="c6-library-use" data-a="c6-use-quick" data-id="${E(q.id)}" aria-label="Use ${E(q.title)}">${t.av}<span class="grow"><span class="ell c6-library-title">${E(q.title)}</span><span class="ell c6-library-sub">${E(t.sub)}</span></span><span class="c6-use-label"><span>Use</span>${I("right", "sm")}</span></button>
        <button class="hbtn c6-quick-more" data-a="c6-quick-menu" data-id="${E(q.id)}" data-anchor="quick-menu-${E(q.id)}" aria-label="More actions for ${E(q.title)}" aria-haspopup="menu">${I("more")}</button>
      </div>`;
    };
    const group = (pinned, title) => {
      const list = items.filter((q) => !!q.pinned === pinned);
      return list.length
        ? `<section><div class="sec-h"><h2>${title}</h2><span class="sub">${list.length}</span></div><div class="c6-library-list">${list.map(row).join("")}</div></section>`
        : "";
    };
    return `<div class="sheet c6-actions-modal" role="dialog" aria-modal="true" aria-label="Quick start"><div class="sheet-h"><h3 class="grow">Quick start</h3><button class="hbtn" data-a="close" aria-label="Close">${I("x")}</button></div>
      <div class="c6-library-toolbar"><p>Pin favorites to Home, or use any quick start.</p><div class="c6-library-controls"><label class="c6-search">${I("search")}<input id="quick-search" data-model="quickQuery" value="${E(H.S.quickQuery || "")}" placeholder="Search quick starts" aria-label="Search quick starts"></label><button class="btn solid sm" data-a="c6-new-quick">${I("plus", "sm")}New quick start</button></div></div>
      <div class="sheet-b">${group(true, "Pinned on Home")}${group(false, "More quick starts")}${items.length ? "" : '<div class="empty">No matching quick starts.</div>'}</div></div>`;
  }
  function quickFormSheet() {
    const f = H.S.quickForm;
    const t = targetInfo(f.kind, f.targetId);
    return `<div class="sheet c6-quick-form" role="dialog" aria-modal="true" aria-label="${f.id ? "Edit" : "New"} quick start"><div class="sheet-h"><button class="hbtn" data-a="c6-back" aria-label="Back to quick starts">${I("right", "c6-back")}</button><h3 class="grow">${f.id ? "Edit" : "New"} quick start</h3><button class="hbtn" data-a="close" aria-label="Close">${I("x")}</button></div>
      <div class="sheet-b">
        <div class="field"><label>Start in</label><button class="c6-select-trigger" data-a="c6-form-picker" aria-expanded="${!!H.S.quickPicker}" aria-haspopup="listbox">${t.av}<span class="grow ell">${E(t.name)}</span>${I("down", "sm")}</button>${H.S.quickPicker ? `<div class="c6-inline-picker">${targetPicker(true)}</div>` : ""}</div>
        <div class="field"><label for="quick-prompt">Starting prompt <span class="quiet">· optional</span></label><textarea id="quick-prompt" data-quick-field="prompt" rows="4" placeholder="What would you like it to do?">${E(f.prompt)}</textarea></div>
        <div class="field"><label for="quick-name">Name</label><input id="quick-name" data-quick-field="title" value="${E(f.title)}" placeholder="e.g. Review my changes" maxlength="80"></div>
        <label class="c6-checkbox"><input type="checkbox" data-quick-field="pinned" ${f.pinned ? "checked" : ""}>Pin to Home</label>
      </div><div class="sheet-f"><button class="btn" data-a="c6-back">Cancel</button><button id="save-quick" class="btn solid" data-a="c6-save-quick" ${f.title.trim() ? "" : "disabled"}>Save quick start</button></div></div>`;
  }

  // Same searchable, grouped option shape as the app Combobox, shared by both entry points.
  function targetOptions() {
    return [
      {
        kind: "quick",
        id: "",
        group: "Quick chat",
        name: "Quick chat - no project",
        description: "",
        av: iconAv("chat"),
      },
      ...H.S.projects
        .filter((p) => !p.botHome && !p.scratch)
        .map((p) => ({
          kind: "project",
          id: p.id,
          group: "Projects",
          name: p.name,
          description: `${H.hostLabel(H.host(p.hostId))} · ${p.path}`,
          av: projAv(p),
        })),
      ...H.S.bots.map((b) => ({
        kind: "bot",
        id: b.id,
        group: "Bots",
        name: b.name,
        description: H.hostLabel(H.host(b.hostId)),
        av: botAv(b),
      })),
    ];
  }
  function targetPicker(form = false) {
    const query = (H.S.targetQuery || "").toLowerCase().trim();
    const words = query.split(/\s+/).filter(Boolean);
    const options = targetOptions().filter((o) =>
      words.every((w) => `${o.name} ${o.description} ${o.group}`.toLowerCase().includes(w)),
    );
    const ctx = H.resolve();
    const selected = form
      ? H.S.quickForm
      : {
          kind:
            ctx.target.kind === "bot"
              ? "bot"
              : ctx.project && !ctx.project.scratch
                ? "project"
                : "quick",
          targetId: ctx.target.botId || ctx.project?.id || "",
        };
    const groups =
      H.S.startPicker === "bot" && !form
        ? ["Quick chat", "Bots", "Projects"]
        : ["Quick chat", "Projects", "Bots"];
    let index = 0;
    const rows = groups
      .map((group) => {
        const list = options.filter((o) => o.group === group);
        if (!list.length) return "";
        return `<div class="pop-h">${group}</div>${list
          .map((o) => {
            const active = index === (H.S.targetActive || 0);
            const on =
              o.kind === selected.kind && (o.kind === "quick" || o.id === selected.targetId);
            return `<button id="c6-option-${index++}" class="opt ${active ? "active" : ""}" role="option" aria-selected="${on}" data-a="c6-target-select" data-kind="${o.kind}" data-id="${E(o.id)}" data-form="${form}">${o.av}<span class="grow"><span class="ell c6-option-name">${E(o.name)}</span>${o.description ? `<span class="od ell c6-option-desc">${E(o.description)}</span>` : ""}</span>${on ? I("check", "check") : ""}</button>`;
          })
          .join("")}`;
      })
      .join("");
    return `<div class="c6-target-picker"><label class="c6-search">${I("search")}<input id="c6-target-search" role="combobox" aria-label="Search projects and bots" aria-autocomplete="list" aria-expanded="true" aria-controls="c6-target-options" ${options.length ? `aria-activedescendant="c6-option-${Math.min(H.S.targetActive || 0, options.length - 1)}"` : ""} data-model="targetQuery" value="${E(H.S.targetQuery || "")}" placeholder="Search projects and bots…" autocomplete="off"></label>
      <div class="c6-target-options" id="c6-target-options" role="listbox" aria-label="Chat destinations">${rows || '<div class="empty">No matching projects or bots.</div>'}</div>
      ${form ? "" : `<div class="c6-picker-footer"><button class="opt" data-a="sheet" data-sheet="add-project">${I("plus", "sm")}Add project</button><button class="opt" data-a="sheet" data-sheet="tpl:blank">${I("plus", "sm")}Add bot</button></div>`}</div>`;
  }
  const focusPicker = () =>
    requestAnimationFrame(() => {
      if (!H.compact) document.getElementById("c6-target-search")?.focus();
    });
  document.addEventListener("input", (e) => {
    if (e.target.dataset.quickField) {
      const field = e.target.dataset.quickField;
      H.S.quickForm[field] = field === "pinned" ? e.target.checked : e.target.value;
      document.getElementById("save-quick").disabled = !H.S.quickForm.title.trim();
    }
    if (e.target.id === "c6-target-search") H.S.targetActive = 0;
    if (e.target.id === "inbox-search") H.S.inboxLimit = INBOX_PAGE_SIZE;
  });
  document.addEventListener(
    "keydown",
    (e) => {
      const picker = e.target.closest(".c6-target-picker");
      if (!picker || e.isComposing) return;
      const opts = [...picker.querySelectorAll('[role="option"]')];
      if (["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!opts.length) return;
        let index = H.S.targetActive || 0;
        if (e.key === "Enter") {
          opts[index]?.click();
          return;
        }
        index = (index + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length;
        H.S.targetActive = index;
        opts.forEach((o, i) => o.classList.toggle("active", i === index));
        document
          .getElementById("c6-target-search")
          .setAttribute("aria-activedescendant", opts[index].id);
        opts[index].scrollIntoView({ block: "nearest" });
      }
      if (e.key === "Escape" && H.S.quickPicker) {
        e.preventDefault();
        e.stopImmediatePropagation();
        H.S.quickPicker = false;
        H.render();
        document.querySelector('[data-a="c6-form-picker"]')?.focus();
      }
    },
    true,
  );

  // ---------- Home ----------
  // Setup panels plus, when there is no computer yet, the work path: a company Hub instead of pairing.
  const setup = (ctx) =>
    `${U.setup(ctx)}${["mobile-pair", "web-missing", "web-blocked"].includes(ctx.blocker?.kind) ? `<div class="notice">${I("globe")}<div class="grow"><b>Using Clisbot at work?</b> Add your company's Hub to see the Hosts it shares with you. No pairing needed.<div class="acts"><button class="btn sm" data-a="sheet" data-sheet="add-hub">Add a Hub</button></div></div></div>` : ""}`;
  function startChoices(ctx) {
    const active =
      ctx.target.kind === "bot"
        ? "bot"
        : ctx.project && !ctx.project.scratch && ctx.target.kind !== "starter"
          ? "project"
          : "quick";
    return `<div class="c6-start-heading"><h1>Where would you like to start?</h1>
      <div class="c6-start-choices" aria-label="Start a conversation">${[
        ["quick", "chat", "Quick chat", "Quick chat"],
        ["project", "folder", "Chat in a project", "In a project"],
        ["bot", "bot", "Chat with a bot", "With a bot"],
      ]
        .map(
          ([id, icon, title, short]) =>
            `<button class="c6-start-choice ${active === id ? "on" : ""}" data-a="c6-start" data-id="${id}" aria-pressed="${active === id}">${I(icon)}<span>${H.compact ? short : title}</span></button>`,
        )
        .join("")}</div></div>`;
  }
  function start(ctx) {
    const fresh = !H.S.sessions.length;
    return `<section class="c6-start ${fresh ? "fresh" : ""}">
      ${startChoices(ctx)}${ctxRow(ctx)}${U.notice(ctx)}${composer(ctx, 3)}
      <div class="c6-under">${hostBrief(ctx)}<span class="grow"></span><button class="c6-pill" data-a="nav" data-id="Import session">${I("inbox", "sm")}Import session</button></div>
      ${setup(ctx)}
    </section>`;
  }
  // Shared Inbox model: attention first, running sessions next, then dated history.
  const INBOX_PAGE_SIZE = 12;
  const DEMO_NOW = Date.parse("2026-10-09T15:20:00+07:00");
  const dateKey = (ago) =>
    new Date(DEMO_NOW - ago * 60000 + 7 * 3600000).toISOString().slice(0, 10);
  const dateLabel = (key) =>
    key === "2026-10-09"
      ? "Today"
      : key === "2026-10-08"
        ? "Yesterday"
        : new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          });
  const sessionTime = (ago) =>
    new Date(DEMO_NOW - ago * 60000).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Ho_Chi_Minh",
    });
  const feedRow = (av, title, sub, status, time, action, id, tone = "") =>
    `<button class="c6-feed-row" data-a="${action}" data-id="${E(id)}">${av}<span class="c6-feed-text"><span class="ell">${E(title)}</span><span class="c6-feed-sub ell">${E(sub)}</span></span><span class="c6-feed-trail"><span class="c6-feed-status ${tone}">${E(status)}</span><span class="c6-feed-time">${E(time)}</span></span>${I("right", "sm")}</button>`;
  function inboxEntries() {
    const sessions = H.S.sessions.map((s) => {
      const b = s.botId && H.bot(s.botId),
        p = H.project(s.projectId),
        h = H.host(s.hostId);
      const online = H.online(h);
      const bucket = ["needs", "failed"].includes(s.status)
        ? "needs"
        : s.status === "running" && online
          ? "active"
          : "recent";
      const status = !online
        ? "Host offline"
        : {
            needs: "Needs approval",
            failed: "Failed",
            running: "Running",
            idle: "Updated",
          }[s.status] || "Updated";
      const sub = `${b?.name || p?.name || "Quick chat"} · ${H.hostLabel(h)} · ${b ? H.providers[b.provider]?.name || "Agent" : H.sessionWho(s)}`;
      return {
        id: s.id,
        kind: s.kind,
        hostId: s.hostId,
        ago: s.ago,
        bucket,
        title: s.title,
        sub,
        search: `${s.title} ${s.preview || ""} ${sub}`,
        av: b ? botAv(b) : p ? projAv(p) : iconAv("chat"),
        status,
        action: "open-session",
        tone: s.status === "needs" ? "attention" : s.status === "failed" ? "failed" : "",
      };
    });
    const runs = H.S.schedules
      .filter((k) => k.failed)
      .map((k) => ({
        id: k.id,
        kind: "run",
        hostId: k.hostId,
        ago: 380,
        bucket: "needs",
        title: k.name,
        sub: `${k.target} · ${H.hostLabel(H.host(k.hostId))}`,
        search: `${k.name} ${k.target} ${k.failed} ${H.hostLabel(H.host(k.hostId))}`,
        av: iconAv("calendar"),
        status: "Failed run",
        action: "open-schedule",
        tone: "failed",
      }));
    return [...sessions, ...runs].sort((a, b) => a.ago - b.ago);
  }
  const inboxRow = (e) =>
    feedRow(
      e.av,
      e.title,
      e.sub,
      e.status,
      e.bucket === "recent" ? sessionTime(e.ago) : H.ago(e.ago),
      e.action,
      e.id,
      e.tone,
    );
  function filteredInbox() {
    const S = H.S,
      words = (S.inboxQuery || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    return inboxEntries().filter(
      (e) =>
        words.every((w) => e.search.toLowerCase().includes(w)) &&
        (!S.inboxHost || e.hostId === S.inboxHost) &&
        (!S.inboxType || e.kind === S.inboxType) &&
        (!S.inboxRange ||
          (S.inboxRange === "today"
            ? dateKey(e.ago) === "2026-10-09"
            : e.ago <= Number(S.inboxRange) * 1440)),
    );
  }
  function inboxSections(entries, { home = false } = {}) {
    const labels = { needs: "Needs you", active: "Active", recent: "Recent" };
    return ["needs", "active", "recent"]
      .map((bucket) => {
        const all = entries.filter((e) => e.bucket === bucket);
        const limit = home
          ? bucket === "recent"
            ? 5
            : 3
          : bucket === "recent"
            ? H.S.inboxLimit || INBOX_PAGE_SIZE
            : all.length;
        const shown = all.slice(0, limit);
        let content;
        if (bucket === "recent") {
          const days = [...new Set(shown.map((e) => dateKey(e.ago)))];
          content = days
            .map(
              (day) =>
                `<div class="c6-date-group" data-day="${day}"><h3 class="c6-date-label">${dateLabel(day)}</h3><div class="c6-feed">${shown
                  .filter((e) => dateKey(e.ago) === day)
                  .map(inboxRow)
                  .join("")}</div></div>`,
            )
            .join("");
        } else
          content = shown.length
            ? `<div class="c6-feed">${shown.map(inboxRow).join("")}</div>`
            : "";
        const empty = {
          needs: "Nothing needs your attention.",
          active: "No sessions running.",
          recent: "No recent sessions.",
        };
        const more = all.length > shown.length;
        return `<section class="c6-inbox-section" data-section="${bucket}"><div class="sec-h"><h2>${labels[bucket]}</h2><span class="sub">${all.length}</span>${home && more ? `<div class="right"><button class="btn ghost sm" data-a="c6-open-inbox" data-section="${bucket}">View all ${I("right", "sm")}</button></div>` : ""}</div>${content || `<div class="c6-section-empty">${empty[bucket]}</div>`}${!home && bucket === "recent" && all.length ? `<div class="c6-load-footer"><span class="quiet small">${shown.length} of ${all.length} recent sessions</span>${more ? '<button class="btn ghost sm" data-a="c6-load-more">Load more</button>' : '<span class="quiet small">You’ve reached the end</span>'}</div>` : ""}</section>`;
      })
      .join("");
  }
  function inboxPage() {
    const S = H.S,
      entries = filteredInbox();
    const filters = !!(S.inboxQuery || S.inboxHost || S.inboxType || S.inboxRange);
    const host = S.inboxHost ? H.hostLabel(H.host(S.inboxHost)) : "All hosts";
    const type =
      { agent: "Agent sessions", chat: "Bot chats", run: "Scheduled runs" }[S.inboxType] ||
      "All types";
    const range =
      { today: "Today", 7: "Last 7 days", 30: "Last 30 days" }[S.inboxRange] || "Any time";
    const button = (key, label) =>
      `<button class="c6-filter-btn ${S[key] ? "selected" : ""}" data-a="c6-inbox-filter-open" data-key="${key}" data-anchor="${key}"><span class="ell">${E(label)}</span>${I("down", "sm")}</button>`;
    return `<div class="c6-inbox-page"><div class="c6-inbox-toolbar"><label class="c6-search">${I("search")}<input id="inbox-search" data-model="inboxQuery" value="${E(S.inboxQuery || "")}" placeholder="Search sessions, projects, bots…" aria-label="Search Inbox">${S.inboxQuery ? `<button class="hbtn" data-a="c6-clear-inbox-search" aria-label="Clear search">${I("x", "sm")}</button>` : ""}</label><div class="c6-inbox-filters">${button("inboxHost", host)}${button("inboxType", type)}${button("inboxRange", range)}</div></div>
      <div class="c6-inbox-summary"><span class="quiet small">${entries.length} ${filters ? "matching" : "total"} items</span>${filters ? '<button class="btn ghost sm" data-a="c6-clear-inbox-filters">Clear filters</button>' : ""}<span class="grow"></span><button class="btn ghost sm" data-a="nav" data-id="Import session">${I("inbox", "sm")}Import session</button></div>
      ${!entries.length && filters ? '<div class="empty c6-inbox-empty">No matching sessions or runs.<button class="btn ghost sm" data-a="c6-clear-inbox-filters">Clear filters</button></div>' : inboxSections(entries)}</div>`;
  }
  function inboxFilterPicker(key) {
    const S = H.S;
    const hostQuery = (S.inboxHostQuery || "").trim().toLowerCase();
    let options;
    if (key === "inboxHost") {
      const used = new Set(inboxEntries().map((e) => e.hostId));
      options = [
        ["", "All hosts"],
        ...S.hosts.filter((h) => used.has(h.id)).map((h) => [h.id, H.hostLabel(h)]),
      ].filter(([, label]) => label.toLowerCase().includes(hostQuery));
    } else
      options =
        key === "inboxType"
          ? [
              ["", "All types"],
              ["agent", "Agent sessions"],
              ["chat", "Bot chats"],
              ["run", "Scheduled runs"],
            ]
          : [
              ["", "Any time"],
              ["today", "Today"],
              ["7", "Last 7 days"],
              ["30", "Last 30 days"],
            ];
    return `<div class="c6-inbox-filter-picker">${key === "inboxHost" ? `<label class="c6-search">${I("search")}<input id="inbox-host-search" data-model="inboxHostQuery" value="${E(S.inboxHostQuery || "")}" placeholder="Search hosts" aria-label="Search hosts"></label>` : ""}${options.map(([value, label]) => `<button class="opt" data-a="c6-set-inbox-filter" data-key="${key}" data-value="${E(value)}"><span class="grow">${E(label)}</span>${(S[key] || "") === value ? I("check", "check") : ""}</button>`).join("") || '<div class="empty">No matching hosts.</div>'}</div>`;
  }
  function overview() {
    if (!H.S.sessions.length && !H.S.schedules.length) return "";
    return `<div class="c6-over"><div class="c6-over-inbox">${inboxSections(inboxEntries(), { home: true })}</div><section><div class="sec-h"><h2>Automations</h2><div class="right"><button class="btn ghost sm" data-a="c5-tab" data-id="schedules">View all ${I("right", "sm")}</button></div></div><div class="c6-auto-list">${automationItems().slice(0, 3).map(automationRow).join("") || '<div class="empty">No Automations yet.</div>'}</div></section></div>`;
  }

  function home(ctx) {
    if (H.compact)
      return `<div class="c6">${hostStrip(ctx)}${startChoices(ctx)}${U.notice(ctx)}${setup(ctx)}${ctx.canSend ? quickStart() : ""}${overview()}</div>`;
    return `<div class="c6">${hostStrip(ctx)}${start(ctx)}${ctx.canSend ? `<div class="c6-quick-wrap">${quickStart()}</div>` : ""}${overview()}</div>`;
  }
  const dock = (ctx) =>
    `<div class="c6-dock">${ctxRow(ctx)}${hostBrief(ctx, { compact: true })}${composer(ctx, 1)}</div>`;

  // Automations follows the existing Hub directory, not the schedules timeline.
  const automationNav = (html) => html.replace(/>Schedules</g, ">Automations<");
  function automationItems() {
    if (H.S.automations) return H.S.automations;
    const projects = H.S.projects.filter((p) => !p.scratch && !p.botHome);
    H.S.automations =
      H.S.sessions.length && projects.length
        ? [
            [
              "release-check",
              "Review changes and prepare a release summary.",
              true,
              true,
              "admin",
              "Manual or API run",
            ],
            [
              "support-triage",
              "Triage incoming support requests.",
              false,
              true,
              "run",
              "Slack mention",
            ],
            [
              "issue-review",
              "Review new issues and suggest next steps.",
              true,
              false,
              "admin",
              "GitHub issue comment",
            ],
          ].map(([name, description, mine, enabled, scope, input], i) => ({
            id: `automation-${i}`,
            name,
            description,
            mine,
            enabled,
            scope,
            input,
            projectId: projects[i % projects.length].id,
            prompt: description,
            runs: [],
            revision: 1,
          }))
        : [];
    return H.S.automations;
  }
  const automationRow = (a) =>
    `<button class="c6-auto-row" data-a="c6-open-automation" data-id="${E(a.id)}"><span class="grow"><span class="c6-auto-name">${E(a.name)}</span><span class="c6-auto-meta">${a.enabled ? "Active" : "Disabled"} · ${a.scope === "admin" ? "Admin" : "Run"}</span></span>${I("right", "sm")}</button>`;
  const autoSummary = (label, value) =>
    `<div class="c6-auto-summary"><span>${E(label)}</span><span class="quiet">${E(value)}</span></div>`;
  function automationForm(a, creating = false) {
    const S = H.S,
      p = H.project(S.autoProjectId || a.projectId);
    return `<div class="c6-auto-form"><div class="c6-auto-card">
      <label>Name<input id="auto-name" data-model="autoName" value="${E(S.autoName ?? a.name)}" placeholder="customer-handoff" ${creating ? "" : "disabled"}></label>
      <label>Description<textarea id="auto-description" data-model="autoDescription" rows="2">${E(S.autoDescription ?? a.description)}</textarea></label>
      <button class="c6-auto-toggle" data-a="c6-auto-toggle" role="switch" aria-checked="${S.autoEnabled ?? a.enabled}"><span>Active</span><span class="pill ${(S.autoEnabled ?? a.enabled) ? "ok" : ""}">${(S.autoEnabled ?? a.enabled) ? "On" : "Off"}</span></button></div>
      <section><h2>Inputs</h2><div class="c6-auto-list">${autoSummary(a.input, "Starts this workflow")}</div></section>
      <section><h2>Workflow</h2><div class="c6-auto-card"><div class="c6-auto-step">${I("automation", "sm")}<b>1 · Run an Agent</b></div><label>Project<button class="c6-auto-project" data-a="pop" data-pop="c6-auto-project" data-anchor="auto-project"><span class="grow">${E(p?.name || "Choose a project")}</span>${I("down", "sm")}</button></label>${p ? `<p class="quiet small">${E(H.hostLabel(H.host(p.hostId)))} · ${E(p.path)}</p>` : ""}<label>Prompt<textarea id="auto-prompt" data-model="autoPrompt" rows="3">${E(S.autoPrompt ?? a.prompt)}</textarea></label></div></section>
      <section><h2>Access</h2><div class="c6-auto-list">${autoSummary("Who can run", "Only you")}</div></section>
      <div class="c6-auto-form-actions"><button class="btn" data-a="c6-auto-cancel">Cancel</button><button class="btn solid" data-a="c6-auto-save" ${!(S.autoName ?? a.name).trim() || !p ? "disabled" : ""}>${creating ? "Create Automation" : "Save changes"}</button></div></div>`;
  }
  function automationsPage() {
    const S = H.S,
      list = automationItems();
    const creating = S.automationSelected === "new";
    const a = creating
      ? {
          name: "",
          description: "",
          enabled: true,
          projectId: S.autoProjectId,
          input: "Manual or API run",
          prompt: "",
        }
      : list.find((a) => a.id === S.automationSelected);
    const back = `<button class="btn ghost sm c6-auto-back" data-a="c6-auto-back">${I("right", "sm")} Automations</button>`;
    if (a) {
      const view = S.automationView || "overview",
        p = H.project(a.projectId);
      const tabs =
        a.scope === "run"
          ? ["overview", "runs"]
          : ["overview", "configuration", "runs", "revisions"];
      let body = creating ? automationForm(a, true) : "";
      if (!creating && view === "overview")
        body = `<section><h2>Workflow</h2><div class="c6-auto-list">${autoSummary("Type", "1 step")}${autoSummary("Description", a.description)}${autoSummary("Host", p ? H.hostLabel(H.host(p.hostId)) : "Unavailable Host")}${autoSummary("Working directory", p?.path || "—")}${autoSummary("Agent", "Codex")}</div></section><section><h2>Inputs</h2><div class="c6-auto-list">${autoSummary(a.input, "Configured input")}</div></section>${a.scope === "admin" ? `<section><h2>Access</h2><div class="c6-auto-list">${autoSummary("Who can run", a.mine ? "Only you" : "Shared with you")}</div></section>` : ""}<section><h2>Run</h2><div class="c6-auto-card"><label>Prompt<textarea id="auto-run-prompt" data-model="autoRunPrompt" rows="3" placeholder="What should this run do?">${E(S.autoRunPrompt || "")}</textarea></label><button class="btn solid" data-a="c6-auto-run" ${a.enabled ? "" : "disabled"}>${I("play", "sm")} Run Automation</button></div></section>`;
      if (!creating && view === "configuration") body = automationForm(a);
      if (!creating && view === "runs")
        body = `<section><h2>Runs</h2><div class="c6-auto-list">${a.runs.map((r) => autoSummary(r.prompt || a.name, r.status)).join("") || '<div class="empty">No runs yet.</div>'}</div></section>`;
      if (!creating && view === "revisions")
        body = `<section><h2>Revision history</h2><div class="c6-auto-list">${autoSummary(`Revision ${a.revision} · Active`, "Current configuration")}</div></section>`;
      return `<div class="c6-automations">${back}<div class="c6-auto-heading"><h1>${creating ? "Create Automation" : E(a.name)}</h1>${creating ? "" : `<span class="pill ${a.enabled ? "ok" : ""}">${a.enabled ? "Active" : "Disabled"}</span>`}</div>${creating ? "" : `<div class="c6-auto-tabs" role="tablist" aria-label="Automation details">${tabs.map((t) => `<button role="tab" aria-selected="${view === t}" class="${view === t ? "on" : ""}" data-a="c6-auto-view" data-id="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div>`}${body}</div>`;
    }
    const canManage = S.hub !== "company";
    const filter = S.automationFilter || (canManage ? "all" : "mine");
    const filters = [
      ["mine", "Mine"],
      ["shared", "Shared with me"],
      ...(canManage ? [["all", "All"]] : []),
    ];
    const matches = (a, f) => f === "all" || (f === "mine" ? a.mine : !a.mine);
    return `<div class="c6-automations"><div class="c6-auto-heading"><h1>Automations</h1>${list.length ? `<button class="btn sm" data-a="c6-new-automation">${I("plus", "sm")} New Automation</button>` : ""}</div><p class="c6-auto-intro">An Automation runs an Agent on a Project when something happens: on a schedule, a GitHub event, or a chat message, or when someone runs it.</p>${
      list.length
        ? `<div class="c6-auto-filters" aria-label="Automation scope">${filters.map(([f, label]) => `<button class="btn sm ${filter === f ? "on" : "ghost"}" aria-pressed="${filter === f}" data-a="c6-auto-filter" data-id="${f}">${label}<span class="quiet">${list.filter((a) => matches(a, f)).length}</span></button>`).join("")}</div><div class="c6-auto-list">${
            list
              .filter((a) => matches(a, filter))
              .map(automationRow)
              .join("") || '<div class="empty">No Automations match this filter.</div>'
          }</div>`
        : `<div class="c6-auto-empty">${I("automation", "lg")}<h2>No Automations yet</h2><button class="btn" data-a="c6-new-automation">${I("plus", "sm")} New Automation</button></div>`
    }</div>`;
  }
  function resetAutomationDraft(a = {}) {
    Object.assign(H.S, {
      autoName: a.name || "",
      autoDescription: a.description || "",
      autoPrompt: a.prompt || "",
      autoEnabled: a.enabled ?? true,
      autoProjectId: a.projectId || H.S.projects.find((p) => !p.botHome && !p.scratch)?.id,
      autoProjectQuery: "",
    });
  }

  // ---------- Pickers ----------
  function pop(kind, ctx) {
    if (kind === "c6-auto-project") {
      const list = H.S.projects.filter(
        (p) =>
          !p.scratch &&
          !p.botHome &&
          `${p.name} ${p.path} ${H.hostLabel(H.host(p.hostId))}`
            .toLowerCase()
            .includes((H.S.autoProjectQuery || "").toLowerCase()),
      );
      return `<label class="c6-search">${I("search")}<input id="auto-project-search" data-model="autoProjectQuery" placeholder="Search projects" value="${E(H.S.autoProjectQuery || "")}" aria-label="Search projects"></label>${list.map((p) => `<button class="opt" data-a="c6-auto-project" data-id="${p.id}">${projAv(p)}<span class="grow">${E(p.name)}<small class="quiet"> · ${E(H.hostLabel(H.host(p.hostId)))}</small></span>${H.S.autoProjectId === p.id ? I("check", "sm") : ""}</button>`).join("") || '<div class="empty">No matching projects.</div>'}`;
    }

    const st = H.S;
    if (kind === "c6-inbox-filter") return inboxFilterPicker(H.S.inboxFilterKey);
    if (kind === "c6-quick-menu") {
      const q = quickItems().find((q) => q.id === H.S.quickMenuId);
      return `<div class="c6-quick-menu" role="menu" aria-label="Quick start actions"><button class="opt" role="menuitem" data-a="c6-pin-quick" data-id="${E(q.id)}">${pinIcon()}${q.pinned ? "Unpin from Home" : "Pin to Home"}</button><button class="opt" role="menuitem" data-a="c6-edit-quick" data-id="${E(q.id)}">${I("pencil", "sm")}Edit quick start</button></div>`;
    }
    if (kind === "c6-project") return targetPicker();
    if (kind === "c6-iso")
      return `<div class="pop-h">Isolation</div>${[
        ["Local", "folder", "Work in the project folder"],
        ["New worktree", "branch", "Its own branch and folder; good for parallel work"],
      ]
        .map(
          ([t, i, d]) =>
            `<button class="opt" data-a="set" data-k="isolation" data-v="${t}">${I(i)}<span class="grow">${t}<span class="od" style="display:block">${d}</span></span>${(st.isolation || "Local") === t ? I("check", "check") : ""}</button>`,
        )
        .join("")}`;
    if (kind === "c6-launch")
      return `<div class="pop-h">What to launch</div>${[
        ["Chat", "chat", "An agent session"],
        ["Terminal", "terminal", "A shell or an agent CLI"],
      ]
        .map(
          ([t, i, d]) =>
            `<button class="opt" data-a="set" data-k="launch" data-v="${t}">${I(i)}<span class="grow">${t}<span class="od" style="display:block">${d}</span></span>${(st.launch || "Chat") === t ? I("check", "check") : ""}</button>`,
        )
        .join(
          "",
        )}<hr><button class="opt" data-a="nav" data-id="Manage profiles">${I("settings")}<span class="grow">Manage profiles</span></button>`;
    return C5.pop(kind, ctx);
  }

  // ---------- Actions ----------
  const focusDraft = () =>
    requestAnimationFrame(() => {
      const t = document.getElementById("draft");
      t?.focus();
      t?.setSelectionRange(t.value.length, t.value.length);
    });
  Object.assign(H.actions, {
    "c6-auto-filter"(el) {
      H.S.automationFilter = el.dataset.id;
    },
    "c6-open-automation"(el) {
      H.S.tab = "schedules";
      H.S.automationSelected = el.dataset.id;
      H.S.automationView = "overview";
      resetAutomationDraft(automationItems().find((a) => a.id === el.dataset.id));
      requestAnimationFrame(() => {
        document.querySelector(".body").scrollTop = 0;
      });
    },
    "c6-new-automation"() {
      H.S.automationSelected = "new";
      resetAutomationDraft();
    },
    "c6-auto-back"() {
      H.S.automationSelected = null;
    },
    "c6-auto-view"(el) {
      H.S.automationView = el.dataset.id;
    },
    "c6-auto-toggle"() {
      H.S.autoEnabled = !H.S.autoEnabled;
    },
    "c6-auto-project"(el) {
      H.S.autoProjectId = el.dataset.id;
      H.S.pop = null;
    },
    "c6-auto-cancel"() {
      if (H.S.automationSelected === "new") H.S.automationSelected = null;
      else {
        resetAutomationDraft(automationItems().find((a) => a.id === H.S.automationSelected));
        H.S.automationView = "overview";
      }
    },
    "c6-auto-save"() {
      const S = H.S;
      if (!S.autoName.trim() || !S.autoProjectId) return;
      let a = automationItems().find((a) => a.id === S.automationSelected);
      if (!a) {
        a = {
          id: `automation-${Date.now()}`,
          mine: true,
          scope: "admin",
          input: "Manual or API run",
          revision: 0,
          runs: [],
        };
        S.automations.push(a);
      }
      Object.assign(a, {
        name: S.autoName.trim(),
        description: S.autoDescription,
        prompt: S.autoPrompt,
        enabled: S.autoEnabled,
        projectId: S.autoProjectId,
        revision: a.revision + 1,
      });
      S.automationSelected = a.id;
      S.automationView = "overview";
    },
    "c6-auto-run"() {
      const a = automationItems().find((a) => a.id === H.S.automationSelected);
      if (!a?.enabled) return;
      a.runs.unshift({
        prompt: H.S.autoRunPrompt || a.prompt,
        status: "Running",
      });
      H.S.automationView = "runs";
    },
    "c6-open-inbox"(el) {
      H.S.tab = "inbox";
      H.S.inboxQuery = "";
      H.S.inboxHost = "";
      H.S.inboxType = "";
      H.S.inboxRange = "";
      H.S.inboxLimit = INBOX_PAGE_SIZE;
      requestAnimationFrame(() => {
        const body = document.querySelector(".body");
        body.scrollTop = 0;
        if (el.dataset.section)
          document
            .querySelector(`[data-section="${el.dataset.section}"]`)
            ?.scrollIntoView({ block: "start" });
      });
    },
    "c6-load-more"() {
      H.S.inboxLimit = (H.S.inboxLimit || INBOX_PAGE_SIZE) + INBOX_PAGE_SIZE;
    },
    "c6-clear-inbox-search"() {
      H.S.inboxQuery = "";
      H.S.inboxLimit = INBOX_PAGE_SIZE;
    },
    "c6-clear-inbox-filters"() {
      H.S.inboxQuery = "";
      H.S.inboxHost = "";
      H.S.inboxType = "";
      H.S.inboxRange = "";
      H.S.inboxLimit = INBOX_PAGE_SIZE;
    },
    "c6-inbox-filter-open"(el) {
      H.S.inboxFilterKey = el.dataset.key;
      H.S.inboxHostQuery = "";
      H.S.pop = { kind: "c6-inbox-filter", anchor: el.dataset.key };
    },
    "c6-set-inbox-filter"(el) {
      H.S[el.dataset.key] = el.dataset.value;
      H.S.inboxLimit = INBOX_PAGE_SIZE;
      H.S.pop = null;
    },
    "c6-quick-menu"(el) {
      H.S.quickMenuId = el.dataset.id;
      H.S.pop = {
        kind: "c6-quick-menu",
        anchor: `quick-menu-${el.dataset.id}`,
      };
    },
    "c6-close-quick-menu"() {
      H.S.pop = null;
    },
    "c6-library"() {
      quickItems();
      H.S.sheet = "quick-all";
      H.S.pop = null;
      H.S.quickQuery = "";
      H.S.quickPicker = false;
    },
    "c6-pin-quick"(el) {
      const q = quickItems().find((q) => q.id === el.dataset.id);
      q.pinned = !q.pinned;
      H.S.pop = null;
      saveQuickStarts();
    },
    "c6-new-quick"() {
      const ctx = H.resolve();
      H.S.quickForm = {
        title: "",
        prompt: "",
        kind:
          ctx.target.kind === "bot"
            ? "bot"
            : ctx.project && !ctx.project.scratch
              ? "project"
              : "quick",
        targetId: ctx.target.botId || ctx.project?.id || "",
        pinned: true,
      };
      H.S.sheet = "quick-form";
      H.S.quickPicker = false;
    },
    "c6-edit-quick"(el) {
      H.S.pop = null;
      H.S.quickForm = { ...quickItems().find((q) => q.id === el.dataset.id) };
      H.S.sheet = "quick-form";
      H.S.quickPicker = false;
    },
    "c6-save-quick"() {
      const f = H.S.quickForm;
      if (!f.title.trim()) return;
      const items = quickItems(),
        id = f.id || `custom-${Date.now()}`;
      const q = { ...f, id, title: f.title.trim(), prompt: f.prompt.trim() };
      const index = items.findIndex((q) => q.id === id);
      if (index < 0) items.push(q);
      else items[index] = q;
      saveQuickStarts();
      H.S.sheet = "quick-all";
      H.S.quickQuery = "";
      H.S.quickPicker = false;
    },
    "c6-use-quick"(el) {
      const q = quickItems().find((q) => q.id === el.dataset.id),
        t = targetInfo(q.kind, q.targetId);
      if (t.hostId && !H.online(H.host(t.hostId))) {
        H.S.sheet = `fix:${t.hostId}`;
        return;
      }
      if (q.kind === "quick") H.actions["c6-quick"]();
      if (q.kind === "bot") H.S.target = { kind: "bot", botId: q.targetId };
      if (q.kind === "project") {
        const p = H.project(q.targetId);
        H.S.pick = { hostId: p.hostId, projectId: p.id };
        H.S.target = {
          kind: "agent",
          provider: H.readyProviders(H.host(p.hostId))[0] || "claude",
        };
      }
      H.S.launch = "Chat";
      H.S.draft = q.prompt;
      H.S.pop = null;
      H.S.sheet = null;
      focusDraft();
    },
    "c6-form-picker"() {
      H.S.quickPicker = !H.S.quickPicker;
      H.S.targetQuery = "";
      H.S.targetActive = 0;
      if (H.S.quickPicker) focusPicker();
    },
    "c6-open-picker"() {
      H.S.startPicker = null;
      H.S.targetQuery = "";
      H.S.targetActive = 0;
      H.S.pop =
        H.S.pop?.kind === "c6-project" ? null : { kind: "c6-project", anchor: "c6-project" };
      H.S.sheet = null;
      if (H.S.pop) focusPicker();
    },
    "c6-target-select"(el) {
      const { kind, id, form } = el.dataset;
      if (form === "true") {
        H.S.quickForm.kind = kind;
        H.S.quickForm.targetId = id;
        H.S.quickPicker = false;
        return;
      }
      if (kind === "quick") {
        H.actions["c6-quick"]();
        return;
      }
      if (kind === "bot") H.S.target = { kind: "bot", botId: id };
      if (kind === "project") {
        const p = H.project(id);
        if (!H.online(H.host(p.hostId))) {
          H.S.pop = null;
          H.S.sheet = `fix:${p.hostId}`;
          return;
        }
        H.S.pick = { hostId: p.hostId, projectId: p.id };
        H.S.target = {
          kind: "agent",
          provider: H.readyProviders(H.host(p.hostId))[0] || "claude",
        };
      }
      H.S.launch = "Chat";
      H.S.pop = null;
      focusDraft();
    },
    "c6-quick"() {
      const ctx = H.resolve();
      if (ctx.host) H.S.pick = { hostId: ctx.host.id, projectId: null };
      H.S.target = { kind: "starter" };
      H.S.launch = "Chat";
      H.S.pop = null;
      focusDraft();
    },
    "c6-start"(el) {
      if (el.dataset.id === "quick") {
        H.actions["c6-quick"]();
        return;
      }
      H.S.startPicker = el.dataset.id;
      H.S.targetQuery = "";
      H.S.targetActive = 0;
      focusPicker();
      H.S.pop = { kind: "c6-project", anchor: "c6-project" };
      H.S.sheet = null;
    },
    "c6-q-bot"(el) {
      const S = H.S;
      S.target = { kind: "bot", botId: el.dataset.id };
      S.launch = "Chat";
      S.draft = el.dataset.text || S.draft;
      S.sheet = null;
      focusDraft();
    },
    "c6-q-proj"(el) {
      const S = H.S;
      const p = H.project(el.dataset.id);
      S.pick = { hostId: p.hostId, projectId: p.id };
      S.target = {
        kind: "agent",
        provider: H.readyProviders(H.host(p.hostId))[0] || "claude",
      };
      S.draft = el.dataset.text || "";
      S.sheet = null;
      focusDraft();
    },
    "c6-q-prompt"(el) {
      H.actions["c6-quick"]();
      H.S.sheet = null;
      H.S.draft = el.dataset.text;
      focusDraft();
    },
  });

  // Mobile pages and sheets share a navigation stack. Snapshots contain only view state,
  // so going Back never rolls back saved pins, selected destinations or the message draft.
  let mobileNav;
  let restoringNavigation = false;
  let pendingHistory = false;
  const navKey = () =>
    `${H.S.sheet || "home"}|${H.S.pop?.kind || ""}|${H.S.quickPicker ? "picker" : ""}`;
  const navSnapshot = () => ({
    key: navKey(),
    sheet: H.S.sheet,
    pop: H.S.pop && { ...H.S.pop },
    quickPicker: !!H.S.quickPicker,
    quickForm: H.S.quickForm,
    quickQuery: H.S.quickQuery || "",
    targetQuery: H.S.targetQuery || "",
    targetActive: H.S.targetActive || 0,
    hostq: H.S.hostq || "",
    scroll: {},
  });
  const scrollSelectors = [".body", ".sheet-b", ".c6-target-options", ".c6-pop-body"];
  function rememberScroll(entry) {
    if (!entry) return;
    for (const selector of scrollSelectors) {
      const el = document.querySelector(selector);
      if (el) entry.scroll[selector] = el.scrollTop;
    }
  }
  function restoreView(entry) {
    for (const key of [
      "sheet",
      "pop",
      "quickPicker",
      "quickForm",
      "quickQuery",
      "targetQuery",
      "targetActive",
      "hostq",
    ])
      H.S[key] = entry[key];
  }
  const historyMarker = () => ({
    c6Mobile: mobileNav.token,
    index: mobileNav.index,
  });
  function navigateBack() {
    if (!H.compact) {
      H.S.quickPicker = false;
      H.S.sheet = H.S.sheet === "quick-form" ? "quick-all" : null;
      H.S.pop = null;
      return;
    }
    if (!mobileNav || mobileNav.index === 0 || pendingHistory) return;
    rememberScroll(mobileNav.entries[mobileNav.index]);
    // Let the next render reconcile the parent with the browser's history entry.
    restoreView(mobileNav.entries[mobileNav.index - 1]);
  }
  H.actions["c6-back"] = navigateBack;
  window.addEventListener("popstate", (e) => {
    if (!mobileNav || e.state?.c6Mobile !== mobileNav.token) return;
    const entry = mobileNav.entries[e.state.index];
    if (!entry) return;
    pendingHistory = false;
    mobileNav.index = e.state.index;
    restoreView(entry);
    restoringNavigation = true;
    H.render();
    restoringNavigation = false;
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && !H.compact && H.S.pop?.kind === "c6-quick-menu") {
        e.preventDefault();
        e.stopImmediatePropagation();
        H.S.pop = null;
        H.render();
        return;
      }
      if (e.key === "Escape" && H.compact && (H.S.sheet || H.S.pop || H.S.quickPicker)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        navigateBack();
        H.render();
      }
    },
    true,
  );

  function decorateMobile() {
    const app = document.querySelector(".app"),
      sheet = app.querySelector(".sheet");
    const fullPageKinds = [
      "quick-all",
      "quick-form",
      "host",
      "hosts",
      "prov",
      "browse",
      "hub",
      "help",
      "fix",
      "session",
      "schedule",
    ];
    const kind = H.S.sheet?.split(":")[0];
    if (sheet) {
      const page = fullPageKinds.includes(kind);
      sheet.classList.add(page ? "c6-mobile-page" : "c6-mobile-sheet");
      if (page) {
        const header = sheet.querySelector(".sheet-h");
        header.querySelectorAll('[data-a="close"],[data-a="c6-back"]').forEach((el) => el.remove());
        header.insertAdjacentHTML(
          "afterbegin",
          `<button class="hbtn c6-nav-back" data-a="c6-back" aria-label="Back">${I("right", "c6-back")}</button>`,
        );
        if (kind === "quick-all") {
          const add = sheet.querySelector('[data-a="c6-new-quick"]');
          add.className = "hbtn c6-nav-add";
          add.innerHTML = I("plus");
          add.setAttribute("aria-label", "New quick start");
          header.append(add);
        }
        if (kind === "quick-form") {
          const save = sheet.querySelector("#save-quick");
          save.textContent = "Save";
          save.className = "btn ghost sm c6-nav-save";
          header.append(save);
          sheet.querySelector(".sheet-f")?.remove();
        }
        sheet.setAttribute("role", "region");
        sheet.removeAttribute("aria-modal");
      }
    }
    if (H.S.quickPicker && sheet) {
      const inline = sheet.querySelector(".c6-inline-picker");
      inline.className = "pop c6-form-target";
      inline.setAttribute("role", "dialog");
      inline.setAttribute("aria-modal", "true");
      app.insertAdjacentHTML("beforeend", '<div class="c6-picker-scrim" data-a="c6-back"></div>');
      app.append(inline);
      sheet.inert = true;
      sheet.setAttribute("aria-hidden", "true");
    }
    const pop = app.querySelector(".pop");
    if (pop) {
      if (sheet && !H.S.quickPicker) {
        sheet.inert = true;
        sheet.setAttribute("aria-hidden", "true");
        app.insertAdjacentHTML("beforeend", '<div class="c6-picker-scrim" data-a="c6-back"></div>');
        pop.classList.add("c6-over-page");
      }
      const kind = H.S.quickPicker ? "c6-project" : H.S.pop?.kind;
      const titles = {
        "c6-project": "Choose project or bot",
        "c6-quick-menu": "Quick start actions",
        "c6-auto-project": "Choose a project",
        "c6-inbox-filter": {
          inboxHost: "Filter by Host",
          inboxType: "Filter by type",
          inboxRange: "Filter by date",
        }[H.S.inboxFilterKey],
        host: "Choose a Host",
        target: "Choose an agent",
        model: "Choose a model",
        thinking: "Thinking",
        perm: "Permissions",
        "c6-iso": "Isolation",
        "c6-launch": "Launch",
        "c5-connect": "Connect",
      };
      const label = titles[kind] || "Choose an option";
      if (!pop.querySelector(".c6-target-picker")) {
        const body = document.createElement("div");
        body.className = "c6-pop-body";
        while (pop.firstChild) body.append(pop.firstChild);
        pop.append(body);
      }
      pop.insertAdjacentHTML(
        "afterbegin",
        `<div class="c6-sheet-handle" aria-hidden="true"></div><div class="c6-pop-header"><h3>${label}</h3><button class="hbtn" data-a="c6-back" aria-label="Close picker">${I("x")}</button></div>`,
      );
      pop.setAttribute("role", "dialog");
      pop.setAttribute("aria-modal", "true");
      pop.setAttribute("aria-label", label);
      if (pop.querySelector(".c6-target-picker") || kind === "host")
        pop.classList.add("c6-tall-picker");
    }
    app.querySelectorAll('[data-a="close"]').forEach((el) => (el.dataset.a = "c6-back"));
    const main = app.querySelector("main");
    if (sheet || pop) {
      main.inert = true;
      main.setAttribute("aria-hidden", "true");
    }
  }
  const sizeViewport = () => {
    document.documentElement.style.setProperty(
      "--c6-viewport-height",
      `${window.visualViewport?.height || innerHeight}px`,
    );
  };
  sizeViewport();
  window.visualViewport?.addEventListener("resize", sizeViewport);
  window.addEventListener("resize", sizeViewport);
  // Installed after the shared script has defined render, before the first browser paint.
  queueMicrotask(() => {
    const baseRender = H.render;
    let renderedState, renderedTab;
    let tabScroll = {};
    H.render = () => {
      if (!H.S) return baseRender();
      if (renderedState !== H.S) tabScroll = {};
      else if (renderedTab)
        tabScroll[renderedTab] = document.querySelector(".body")?.scrollTop || 0;
      const tabChanged = renderedState !== H.S || renderedTab !== H.S.tab;
      const compact = H.S.device === "mobile" || innerWidth < 760;
      let entry;
      if (compact) {
        if (!mobileNav || mobileNav.state !== H.S) {
          mobileNav = {
            state: H.S,
            token: `home06-${Date.now()}-${Math.random()}`,
            index: 0,
            entries: [
              {
                ...navSnapshot(),
                key: "home||",
                sheet: null,
                pop: null,
                quickPicker: false,
              },
            ],
          };
          history.replaceState(historyMarker(), "");
          pendingHistory = false;
        }
        const current = mobileNav.entries[mobileNav.index];
        if (!restoringNavigation) rememberScroll(current);
        const key = navKey();
        if (
          !restoringNavigation &&
          key !== current.key &&
          current.pop?.kind === "c6-quick-menu" &&
          H.S.sheet === "quick-form"
        ) {
          entry = navSnapshot();
          mobileNav.entries[mobileNav.index] = entry;
          history.replaceState(historyMarker(), "");
        } else if (!restoringNavigation && key !== current.key) {
          const parent = mobileNav.entries.findLastIndex(
            (e, i) => i < mobileNav.index && e.key === key,
          );
          if (parent >= 0) {
            const delta = parent - mobileNav.index;
            mobileNav.index = parent;
            entry = mobileNav.entries[parent];
            restoreView(entry);
            pendingHistory = true;
            history.go(delta);
          } else {
            entry = navSnapshot();
            mobileNav.entries.splice(mobileNav.index + 1);
            mobileNav.entries.push(entry);
            mobileNav.index++;
            history.pushState(historyMarker(), "");
          }
        } else {
          entry = { ...navSnapshot(), scroll: current.scroll };
          mobileNav.entries[mobileNav.index] = entry;
          if (history.state?.c6Mobile !== mobileNav.token && !pendingHistory)
            history.replaceState(historyMarker(), "");
        }
      }
      baseRender();
      if (!compact && H.S.pop?.kind === "c6-quick-menu") {
        document
          .querySelector(".app")
          .insertAdjacentHTML(
            "beforeend",
            '<div class="c6-menu-scrim" data-a="c6-close-quick-menu"></div>',
          );
      }
      if (compact) {
        // Moving the form picker to its sheet must not interrupt typing into search.
        const focused = document.activeElement;
        const focusId = focused?.id;
        const caret =
          typeof focused?.selectionStart === "number"
            ? [focused.selectionStart, focused.selectionEnd]
            : null;
        decorateMobile();
        const input = focusId && document.getElementById(focusId);
        if (input && !input.closest("[inert]")) {
          input.focus({ preventScroll: true });
          if (caret) input.setSelectionRange(...caret);
        }
        for (const [selector, top] of Object.entries(entry?.scroll || {})) {
          const el = document.querySelector(selector);
          if (el) el.scrollTop = top;
        }
      }
      if (tabChanged) {
        const body = document.querySelector(".body");
        if (body) body.scrollTop = tabScroll[H.S.tab] || 0;
      }
      renderedState = H.S;
      renderedTab = H.S.tab;
    };
  });

  const navTail = () =>
    ["grid:Connectors"]
      .map((x) => {
        const [i, t] = x.split(":");
        return `<button class="sb-item" data-a="nav" data-id="${t}">${I(i)}${t}</button>`;
      })
      .join("");
  // 06 drops the "first message creates a bot" idea, so the shared empty copy is replaced.
  const plainCopy = (html) =>
    html
      .replace("Your first message on Home creates one.", "Create a bot to chat with it here")
      .replace(
        "No bots yet. Your first quick chat creates one.",
        "No bots yet. Choose Add bot in the conversation picker.",
      );

  H.concept = {
    num: 6,
    name: "Home",
    tagline: "06 · Home = New workspace + tổng quan",
    devices: ["desktop", "mobile"],
    variants: [
      {
        id: "using",
        label: "Đang dùng · 1 Hub cá nhân",
        scenario: { desktop: "returning" },
        hub: "one",
        hint: "Mở app: ngữ cảnh lần gửi gần nhất (This Mac › clisbot · Codex), Quick start theo Bot/Project, việc cần bạn và lịch. Bấm một Host để xem agent và cách sửa.",
      },
      {
        id: "offline",
        label: "Host gần nhất offline",
        scenario: { desktop: "host-offline" },
        hub: "one",
        hint: "Lần trước gửi trên Studio Mini (offline) → chọn This Mac › clisbot, báo rõ, giữ draft, có Fix.",
      },
      {
        id: "company",
        label: "Hub công ty 124 host + Hub hết đăng nhập",
        scenario: { desktop: "busy" },
        hub: "many",
        hint: "3 Hub, 128 Host. Dải Hosts chỉ hiện máy bạn dùng + mỗi Hub một mục; bộ chọn Host có tìm kiếm; Browse all 124 hosts.",
      },
      {
        id: "first",
        label: "Lần đầu (Desktop: local · Mobile: chưa có máy)",
        scenario: { desktop: "first-desktop", mobile: "first-mobile" },
        hub: "none",
        hint: "Desktop: máy này sẵn sàng, gõ ngay (No project chạy trong thư mục nháp, không tạo Bot). Mobile: ghép nối máy tính hoặc Add a Hub.",
      },
    ],
    onSeed: (st) => {
      C5.seedHubs(st);
      st.launch = "Chat";
      st.isolation = "Local";
      const dev = st.hosts.find((h) => h.id === "dev");
      if (dev) dev.providers.copilot = "signin";
      if (st.sessions.length) {
        const samples = [
          "Review deployment checklist",
          "Update API documentation",
          "Investigate slow queries",
          "Prepare release summary",
          "Clean up test fixtures",
          "Audit dependencies",
          "Improve error messages",
          "Review onboarding flow",
        ];
        const projects = st.projects.filter((p) => !p.botHome && !p.scratch);
        for (let i = 0; i < 28; i++) {
          const p = projects[i % projects.length];
          st.sessions.push({
            id: `history-${i}`,
            kind: "agent",
            provider: i % 2 ? "claude" : "codex",
            title: `${samples[i % samples.length]}${i >= samples.length ? ` · ${Math.floor(i / samples.length) + 1}` : ""}`,
            preview: "Finished and ready to review.",
            projectId: p.id,
            hostId: p.hostId,
            status: "idle",
            ago: 2880 + Math.floor(i / 3) * 1440 + (i % 3) * 90,
          });
        }
        if (!st.sessions.some((s) => s.status === "running")) {
          const p = projects[0];
          st.sessions.push({
            id: "active-demo",
            kind: "agent",
            provider: "codex",
            title: "Run integration checks",
            preview: "Checking the latest changes…",
            projectId: p.id,
            hostId: p.hostId,
            status: "running",
            ago: 2,
          });
        }
      }
    },
    // "No project" chats run in one scratch folder per Host; no Bot is created.
    quickChatProject: (host) => {
      const id = `scratch-${host.id}`;
      let p = H.project(id);
      if (!p) {
        p = {
          id,
          hostId: host.id,
          name: "Quick chats",
          path: "~/.clisbot/quick-chats",
          usedAgo: 0,
          scratch: true,
        };
        H.S.projects.push(p);
      }
      return p;
    },
    sidebar: () => automationNav(plainCopy(C5.sidebar(navTail()))),
    header: (ctx) => automationNav(C5.header(ctx)),
    pop,
    sheet: (kind, id, ctx) =>
      kind === "quick-all"
        ? quickAllSheet()
        : kind === "quick-form"
          ? quickFormSheet()
          : C5.sheet(kind, id, ctx),
    render: (ctx) =>
      plainCopy(
        (
          {
            home,
            chat: C5.chatPage,
            inbox: inboxPage,
            schedules: automationsPage,
            settings: C5.settingsPage,
          }[H.S.tab] || home
        )(ctx),
      ),
    bottom: (ctx) =>
      H.compact ? `${H.S.tab === "home" ? dock(ctx) : ""}${automationNav(C5.tabbar())}` : "",
    notes: `<h2>06 · Home = New workspace + tổng quan</h2>
      <p>Một file, ít biến thể để chốt hướng: Desktop/Mobile × 4 trạng thái.</p>
      <h3>Painpoint đang giải quyết</h3>
      <table><tr><th>Hiện tại</th><th>Option 06</th></tr>
      <tr><td>Hai màn “bắt đầu”: Home (<code>/open-project</code>) chỉ có thẻ Create a bot / Add a project / provider; muốn chat phải bấm New workspace (<code>/new</code>).</td><td>Home <b>là</b> New workspace: cùng hàng ngữ cảnh, composer, Import session; mở app là gõ được. Sidebar bỏ mục New workspace, nút + xanh và ⌘N đưa về composer của Home.</td></tr>
      <tr><td>New workspace bắt buộc Project; chat nhanh và Bot nằm chỗ khác.</td><td>Project picker có <b>Quick chat - no project</b> (chạy trong một thư mục nháp trên Host, <b>không tạo Bot</b>) và <b>Bots</b> (một Bot là một Project), rồi Projects của Host.</td></tr>
      <tr><td>Host chỉ là badge nhỏ trong picker; tình trạng và thêm Host nằm ở Welcome / More ways.</td><td><b>Dải Hosts</b> trên cùng, không phải card: máy này, các máy bạn dùng, mỗi Hub một mục, Connect, Help; sự cố gộp thành một dòng đếm, mở chi tiết khi cần. Host đứng đầu hàng ngữ cảnh.</td></tr>
      <tr><td>Chọn Host không biết nó chạy được gì.</td><td>Dưới composer: icon provider, “3/40+ agents ready”, nút chung “Status &amp; Setup”. Bấm Host (dải trên, danh sách Hosts, dòng này) mở <b>chi tiết Host</b>: trạng thái, từng agent (Ready / Sign in / Install), hoạt động, Host settings, Troubleshoot, Pair a phone, Logs.</td></tr>
      <tr><td>Không nhớ và không giải thích vì sao chọn Host/Project; Host mất thì không có fallback.</td><td>Chọn theo lần gửi thành công gần nhất, fallback có thông báo và giữ draft; không lặp lại thời gian dùng gần nhất dưới composer.</td></tr>
      <tr><td>Không thấy việc cần mình, việc đang chạy, lịch sắp chạy.</td><td>Dưới composer: <b>Quick start</b>, rồi <b>Inbox</b>: Needs you → Active → Recent (Today, Yesterday, theo ngày), rồi <b>Automations</b>; Hosts chỉ nằm ở dải trên, không lặp lại bên dưới.</td></tr>
      <tr><td>Mobile: Home mở sau drawer sidebar; ngữ cảnh New workspace xếp dọc tốn chỗ; không có tab.</td><td>5 tab dưới; tab Chat = sidebar hiện tại. Composer neo đáy. Quick start 2 dòng + View all; quản lý/form/chi tiết mở toàn trang, bộ chọn mở bottom sheet; Back giữ draft, search và vị trí cuộn.</td></tr>
      <tr><td>Hub lớn (trăm Host) không có chỗ hiển thị hợp lý.</td><td>Dải Hosts chỉ hiện máy bạn dùng và một mục cho mỗi Hub (online/tổng); Browse all + tìm kiếm.</td></tr></table>
      <h3>Quick start</h3><ul><li>Việc kèm Bot dùng avatar tròn của Bot (“Ask Product assistant”); việc trong Project dùng ô vuông của Project (“Fix failing tests · clisbot”); câu hỏi không cần Project dùng icon chat; Quick start ghép Bot hoặc Project có sẵn với prompt tùy ý, cho sửa trước khi gửi. Bộ chọn dùng cấu trúc Combobox: search, nhóm kết quả, avatar, dấu chọn, phím mũi tên/Enter.</li><li>Mặc định Desktop 2 hàng × 3, mobile 2 hàng × 2; <b>View all</b> quản lý ghim, dùng ngay hoặc tạo Quick start từ project/bot + starting prompt. Bấm dòng để dùng; menu ⋯ chứa Pin/Unpin và Edit, trên mobile mở action sheet. Ghim và Quick start mới được lưu trong trình duyệt theo biến thể và kích thước preview.</li></ul>
      <h3>Giữ nguyên từ New workspace</h3><ul><li>Project → Isolation (Local / New worktree) → … → Chat/Terminal; Isolation và Chat/Terminal chỉ hiện khi có Project.</li><li>Composer: model, mic, gửi; Terminal đổi placeholder “Run a command…”.</li><li>Import session.</li></ul>
      <h3>Automations</h3><p>Giữ cấu trúc màn hiện tại: Mine / Shared with me / All (Admin), dòng tên + trạng thái + quyền; New Automation. Chi tiết gồm Overview / Configuration / Runs / Revisions theo quyền. Mẫu tương tác dùng dữ liệu giả trong bộ nhớ trình duyệt.</p>
      <h3>Inbox thay History</h3><p>Cùng thứ tự Needs you → Active → Recent với Home; Recent chia Today, Yesterday và theo ngày. Search toàn bộ lịch sử, lọc Host/Type/Date; Load more 12 mục/lần, giữ nhóm ngày liên tục và vị trí cuộn từng tab. Mở chi tiết để Approve/Retry; giữ Import session.</p>
      <h3>Chưa chốt</h3><ul><li>“No project” cần một chỗ chạy: prototype dùng một thư mục nháp mỗi Host (<code>~/.clisbot/quick-chats</code>), hiện trong Inbox như Quick chats. Cần chốt nó là một Project ẩn hay một Workspace thường.</li></ul>
      <h3>Triển khai nhỏ nhất</h3><p><code>/open-project</code> render khối start dùng lại composer và picker của <code>NewWorkspaceScreen</code>, rồi phần tổng quan; <code>/new</code> giữ nguyên làm route cũ. Đặt trong <code>clisbot/home</code> sau một feature flag; tab dưới mobile là bước riêng, chốt sau.</p>`,
  };
})();
