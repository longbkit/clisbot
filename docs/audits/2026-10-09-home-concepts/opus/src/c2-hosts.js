/* oxlint-disable no-nested-ternary, complexity -- prototype view templates read as one expression per state. */
/* 02 · Hosts — start from the computer. Pick a Host card, then a Project, then type. Everything below is scoped to that Host. */
(() => {
  const { icon: I, esc: E, ui: U } = H;
  const localPending = () =>
    ({
      probing: ["Looking for Clisbot…", "loader"],
      missing: ["Clisbot isn't running", "alert"],
      blocked: ["Blocked by the browser", "lock"],
      starting: ["Starting…", "loader"],
    })[H.S.local];
  const hostCard = (h, ctx) => {
    const sel = ctx.host?.id === h.id;
    const S = H.S;
    const ss = S.sessions.filter((s) => s.hostId === h.id);
    const needs = ss.filter((s) => s.status === "needs").length;
    const running = ss.filter((s) => s.status === "running").length;
    const ready = H.readyProviders(h);
    const on = h.status === "online";
    const status = on
      ? '<span class="pill ok"><span class="dot ok"></span>Online</span>'
      : h.status === "connecting"
        ? `<span class="pill">${I("loader", "sm spin")} Connecting</span>`
        : h.status === "starting"
          ? `<span class="pill">${I("loader", "sm spin")} Starting</span>`
          : '<span class="pill"><span class="dot off"></span>Offline</span>';
    return `<button class="c2-host ${sel ? "sel" : ""} ${on ? "" : "off"}" data-a="${on ? "pick-host" : "noop"}" data-id="${h.id}">
      <span class="c2-host-top">${I(H.hostIcon(h))}<span class="grow ell"><b>${E(H.hostLabel(h))}</b></span>${status}</span>
      <span class="rm ell">${H.isLocal(h) ? `${E(h.name)} · ` : ""}${E(H.hostVia(h))}${on ? "" : ` · last seen ${E(h.lastSeen || "—")}`}</span>
      <span class="c2-host-foot">${
        on
          ? `<span class="c2-pv">${ready.map((p) => H.pv(p)).join("") || '<span class="pill warn">No agent ready</span>'}</span><span class="grow"></span>${needs ? `<span class="pill warn">${needs} need${needs > 1 ? "" : "s"} you</span>` : ""}${running ? `<span class="pill run">${running} running</span>` : ""}`
          : h.status === "offline"
            ? `<span class="btn sm" data-a="reconnect" data-id="${h.id}">${I("refresh", "sm")} Reconnect</span>`
            : ""
      }</span>
    </button>`;
  };
  const pendingLocal = () => {
    const p = localPending();
    if (!p || H.S.local === "starting") return "";
    return `<div class="c2-host off sel"><span class="c2-host-top">${I("monitor")}<span class="grow ell"><b>This computer</b></span></span><span class="rm">localhost:6767</span>
      <span class="c2-host-foot"><span class="pill ${p[1] === "loader" ? "" : "warn"}">${I(p[1], `sm ${p[1] === "loader" ? "spin" : ""}`)} ${p[0]}</span><span class="grow"></span>${H.S.local === "probing" ? "" : `<span class="btn sm" data-a="probe">${I("refresh", "sm")} Look again</span>`}</span></div>`;
  };
  const strip = (ctx) => {
    const S = H.S;
    const hosts = [...S.hosts].sort(
      (a, b) => H.isLocal(b) - H.isLocal(a) || (a.usedAgo ?? 1e9) - (b.usedAgo ?? 1e9),
    );
    return `<section><div class="sec-h"><h2>Run on</h2><span class="sub">${S.hosts.length ? "New messages go to the selected computer" : "Connect a computer to run agents"}</span><div class="right"><button class="btn ghost sm" data-a="sheet" data-sheet="hosts">Manage</button></div></div>
      <div class="c2-strip">${pendingLocal()}${hosts.map((h) => hostCard(h, ctx)).join("")}
      <button class="c2-host add" data-a="sheet" data-sheet="pair">${I("plus")}<b>Connect a computer</b><span class="rm">${H.compact ? "Scan the QR code from Pair Device" : "Pairing link, address or SSH"}</span></button></div></section>`;
  };
  const projectTabs = (ctx) => {
    if (!ctx.host || ctx.reason === "bot")
      return ctx.reason === "bot"
        ? `<div class="c2-projects"><span class="c2-proj on">${I("bot", "sm")} ${E(ctx.project?.name)} <span class="quiet">· bot's own folder</span></span><button class="link" data-a="target-agent">Use an agent instead</button></div>`
        : "";
    const list = H.projectsOn(ctx.host.id);
    return `<div class="c2-projects"><span class="quiet small">Project</span>
      ${list.map((p) => `<button class="c2-proj ${ctx.project?.id === p.id ? "on" : ""}" data-a="pick-project" data-id="${p.id}">${I("folder", "sm")}${E(p.name)}</button>`).join("")}
      <button class="c2-proj ${ctx.target.kind === "starter" ? "on" : ""}" data-a="pick-personal">${I("spark", "sm")}No project · assistant</button>
      <button class="c2-proj add" data-a="sheet" data-sheet="add-project">${I("plus", "sm")}Add</button></div>`;
  };
  const checklist = (ctx) => {
    const S = H.S;
    if (S.sessions.length || !ctx.host || ctx.blocker?.kind === "providers") return "";
    const h = ctx.host;
    const ready = H.readyProviders(h);
    const steps = [
      [
        h.status === "online",
        H.isLocal(h) ? `${H.hostLabel(h)} is connected` : `${h.name} is connected`,
        H.isLocal(h)
          ? "Clisbot runs here; your code stays on this computer."
          : `Over ${H.hostVia(h)}.`,
      ],
      [
        ready.length > 0,
        `${ready.map((p) => H.providers[p].name).join(", ")} ready`,
        "Found the agents already installed on this computer.",
      ],
      [
        false,
        "Send your first message",
        ctx.target.kind === "starter"
          ? "Starts a Personal assistant with its own folder. Pick a project to work on code."
          : `Starts an agent session in ${ctx.project?.name}.`,
      ],
    ];
    return `<div class="c2-check">${steps.map(([done, t, d], i) => `<div class="step ${done ? "done" : "now"}"><span class="n">${done ? I("check", "sm") : i + 1}</span><div><div class="st">${E(t)}</div><div class="sd">${E(d)}</div></div></div>`).join("")}</div>`;
  };
  const col = (title, sub, items, empty) =>
    `<div class="c2-col"><div class="sec-h"><h2>${title}</h2><span class="sub">${sub}</span></div>${items || `<div class="empty">${empty}</div>`}</div>`;
  const board = () => {
    const S = H.S;
    if (!S.sessions.length && !S.schedules.length) return "";
    const att = H.attention().filter((a) => a.kind !== "offline");
    const running = S.sessions.filter((s) => s.status === "running");
    const next = H.upcoming()
      .filter((k) => !k.paused)
      .slice(0, 4);
    const card = (a) =>
      `<div class="c2-att">${U.attnIcon(a)}<div class="grow"><div class="rt ell">${E(a.title)}</div><div class="rm">${E(a.text)}</div><div class="rm">${a.s ? `${E(H.hostLabel(H.host(a.s.hostId)))} · ${H.ago(a.ago)}` : ""}</div><div class="acts">${U.attnActions(a)}</div></div></div>`;
    const tab = S.c2tab || "needs";
    const cols = {
      needs: col(
        "Needs you",
        att.length ? `${att.length}` : "",
        att.map(card).join(""),
        "Nothing waiting on you",
      ),
      running: col(
        "Running",
        running.length ? `${running.length}` : "",
        running.length
          ? `<div class="rows">${running.map((s) => U.sessionRow(s, { preview: true })).join("")}</div>`
          : "",
        "No agent is working right now",
      ),
      next: col(
        "Up next",
        "",
        next.length ? `<div class="rows">${next.map(U.schedRow).join("")}</div>` : "",
        "No schedules",
      ),
    };
    if (H.compact)
      return `<section><span class="tabs c2-tabs">${[
        ["needs", `Needs you${att.length ? ` · ${att.length}` : ""}`],
        ["running", "Running"],
        ["next", "Up next"],
      ]
        .map(
          ([k, t]) =>
            `<button class="${tab === k ? "on" : ""}" data-a="c2-tab" data-id="${k}">${t}</button>`,
        )
        .join("")}</span>${cols[tab]}</section>`;
    return `<section class="c2-board">${cols.needs}${cols.running}${cols.next}</section>`;
  };
  const recent = (ctx) => {
    const S = H.S;
    if (!S.sessions.length) return "";
    const scope = S.c2scope || "host";
    const list = H.recent()
      .filter((s) => scope === "all" || s.hostId === ctx.host?.id)
      .slice(0, 6);
    return `<section><div class="sec-h"><h2>Recent</h2><div class="right"><span class="tabs">${[
      ["host", ctx.host ? `On ${H.hostLabel(ctx.host)}` : "This host"],
      ["all", "All computers"],
    ]
      .map(
        ([k, t]) =>
          `<button class="${scope === k ? "on" : ""}" data-a="c2-scope" data-id="${k}">${E(t)}</button>`,
      )
      .join("")}</span></div></div>
      <div class="rows">${list.map((s) => U.sessionRow(s, { preview: true })).join("") || '<div class="empty">No sessions on this computer yet.</div>'}</div></section>`;
  };
  Object.assign(H.actions, {
    "c2-tab"(el) {
      H.S.c2tab = el.dataset.id;
    },
    "c2-scope"(el) {
      H.S.c2scope = el.dataset.id;
    },
  });
  H.concept = {
    num: 2,
    name: "Hosts",
    tagline: "02 · Hosts — bắt đầu từ máy tính",
    render: (ctx) => `<div class="c2">
      ${strip(ctx)}
      ${U.notice(ctx)}
      ${ctx.blocker && !["no-project"].includes(ctx.blocker.kind) ? U.setup(ctx) : ""}
      <section class="c2-compose">${projectTabs(ctx)}${U.composer(ctx, { rows: 3 })}${U.starterHint(ctx)}${ctx.blocker?.kind === "no-project" ? U.setup(ctx) : ""}</section>
      ${checklist(ctx)}${board()}${recent(ctx)}</div>`,
    notes: `<h2>02 · Hosts</h2>
      <p><b>Ý tưởng:</b> Agent chạy trên máy tính, nên Home bắt đầu từ máy tính. Chọn thẻ Host → chọn Project → gõ. Mọi thứ bên dưới (Running, Recent) được lọc theo Host đang chọn.</p>
      <h3>Bố cục</h3><ul>
      <li><b>Run on</b>: thẻ cho từng Host — máy này đứng đầu (“This Mac · LongPro2Max · Local”), trạng thái, agent sẵn sàng, số việc đang chạy/cần bạn; Host offline có Reconnect ngay trên thẻ; thẻ cuối là <b>Connect a computer</b>.</li>
      <li>Hàng Project dạng tab của Host đó + “No project · assistant” + Add.</li>
      <li>Composer, rồi bảng 3 cột: <b>Needs you / Running / Up next</b>; cuối là <b>Recent</b> (máy này ↔ tất cả).</li>
      <li>Mobile: thẻ Host cuộn ngang; bảng 3 cột thành tab.</li></ul>
      <h3>Host &amp; lần đầu</h3><ul>
      <li>Lần đầu Desktop: thẻ máy này đã chọn + checklist 3 bước (đã kết nối ✓, agent sẵn sàng ✓, gửi tin đầu tiên).</li>
      <li>Web: thẻ “This computer” hiện đúng trạng thái dò/không thấy/bị chặn và “Look again”. Mobile: chỉ có thẻ Connect + 3 bước ghép nối.</li></ul>
      <h3>Mạnh</h3><ul><li>Không bao giờ nhầm tin nhắn chạy ở đâu; kết nối Host là thao tác hạng nhất.</li><li>Hợp người dùng nhiều máy/server, theo dõi từ điện thoại.</li></ul>
      <h3>Đánh đổi</h3><ul><li>Composer bị đẩy xuống dưới hàng Host — chat không còn “chính diện” tuyệt đối.</li><li>Người chỉ có một máy thấy thêm một tầng không cần thiết.</li></ul>`,
  };
})();
