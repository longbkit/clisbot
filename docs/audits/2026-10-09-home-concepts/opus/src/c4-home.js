/* oxlint-disable no-nested-ternary, complexity -- prototype view templates read as one expression per state. */
/* 04 · Home — the synthesis. Composer first (01), where it runs is explicit and fixable in place (02),
   what waits on you is actionable and the day is on a timeline (03). Plus: one pulse line, one Continue card,
   a setup stepper that disappears when done, and nothing shown that has nothing to say. */
(() => {
  const { icon: I, esc: E, ui: U } = H;
  const pulse = () => {
    const S = H.S;
    if (!S.sessions.length && !S.schedules.length) return "";
    const att = H.attention();
    const needs = att.filter((a) => a.kind !== "offline").length;
    const running = S.sessions.filter((s) => s.status === "running").length;
    const offline = att.filter((a) => a.kind === "offline").length;
    const next = H.upcoming().find(
      (k) => !k.paused && k.inMin > 0 && H.host(k.hostId).status === "online",
    );
    const chip = (a, id, cls, body) =>
      `<button class="c4-pulse-chip ${cls}" data-a="${a}" data-id="${id}">${body}</button>`;
    return `<div class="c4-pulse">${[
      needs
        ? chip(
            "c4-jump",
            "needs",
            "warn",
            `<span class="dot warn"></span>${needs} need${needs > 1 ? "" : "s"} you`,
          )
        : chip("noop", "", "", `${I("check", "sm")} Nothing waiting on you`),
      running
        ? chip("c4-jump", "recent", "", `<span class="dot run"></span>${running} running`)
        : "",
      offline
        ? chip("c4-jump", "needs", "", `${I("offline", "sm")} ${offline} computer offline`)
        : "",
      next
        ? chip(
            "open-schedule",
            next.id,
            "",
            `${I("automation", "sm")} ${E(next.name)} · ${E(next.at)}`,
          )
        : "",
    ].join("")}</div>`;
  };
  const stepper = (ctx) => {
    const S = H.S;
    if (S.sessions.length) return "";
    const h = ctx.host;
    const b = ctx.blocker?.kind;
    const connected = h && h.status === "online";
    const ready = connected && H.readyProviders(h).length > 0;
    const hostText = connected
      ? `${H.hostLabel(h)} connected`
      : b === "starting"
        ? "Starting Clisbot…"
        : b === "probing"
          ? "Looking for Clisbot…"
          : H.compact
            ? "Connect your computer"
            : "Connect this computer";
    const agentText = ready
      ? `${H.readyProviders(h)
          .map((p) => H.providers[p].name)
          .slice(0, 2)
          .join(" + ")} ready`
      : connected
        ? "Set up an agent"
        : "Agent ready";
    const steps = [
      [connected, hostText, b === "starting" || b === "probing"],
      [ready, agentText, false],
      [false, "Say hello", false],
    ];
    const nowIdx = steps.findIndex(([done]) => !done);
    return `<ol class="c4-steps">${steps.map(([done, t, busy], i) => `<li class="${done ? "done" : i === nowIdx ? "now" : ""}"><span class="n">${busy ? I("loader", "sm spin") : done ? I("check", "sm") : i + 1}</span>${E(t)}</li>`).join('<li class="sep"></li>')}</ol>`;
  };
  const contextBar = (ctx) => `<div class="c4-ctx">
      <span class="quiet small">Runs on</span>${U.hostChip(ctx)}<span class="ctx-sep">›</span>${U.projectChip(ctx)}
      <span class="c4-why">${U.why(ctx)}</span>
      <button class="btn ghost sm c4-connect" data-a="sheet" data-sheet="pair">${I("plus", "sm")} Connect a computer</button></div>`;
  const starters = (ctx) => {
    if (!ctx.canSend) return "";
    const code = ctx.target.kind === "agent";
    const list = code
      ? [
          ["Fix a bug", "Find and fix the bug where "],
          ["Review my changes", "Review my uncommitted changes and point out risks."],
          [
            "Explain this project",
            "Give me a tour of this project: structure, entry points, how to run it.",
          ],
          ["Plan a feature", "Write an implementation plan for "],
        ]
      : [
          ["Plan my week", "Help me plan my week. Ask me what's on my plate first."],
          ["Draft an email", "Draft a short email to "],
          ["Research a topic", "Research and compare "],
          ["Summarize a doc", "Summarize the attached document in 5 bullets."],
        ];
    return `<div class="c4-starters">${list.map(([t, text]) => `<button class="c4-chip" data-a="starter" data-text="${E(text)}">${t}</button>`).join("")}</div>`;
  };
  const moreWays = () =>
    H.S.sessions.length
      ? ""
      : `<div class="c4-more"><span class="quiet small">More ways to start</span>
      <button class="btn ghost sm" data-a="sheet" data-sheet="add-project">${I("folder", "sm")} Open a folder as a project</button>
      <button class="btn ghost sm" data-a="nav" data-id="Import session">${I("inbox", "sm")} Import a terminal session</button>
      <button class="btn ghost sm" data-a="nav" data-id="Create bot">${I("bot", "sm")} Create a bot</button></div>`;
  const needs = () => {
    const att = H.attention();
    if (!att.length) return "";
    const card = (a) => `<div class="c4-need ${a.kind}">${U.attnIcon(a)}<div class="grow">
        <div class="c4-need-t"><b class="ell">${E(a.title)}</b>${a.ago != null ? `<span class="quiet small">${H.ago(a.ago)}</span>` : ""}</div>
        <div class="c4-need-x">${E(a.text)}</div>${a.s ? `<div class="rm">${U.meta(a.s)}</div>` : ""}</div><div class="acts">${U.attnActions(a)}</div></div>`;
    return `<section id="c4-needs"><div class="sec-h"><h2>Needs you</h2><span class="pill warn">${att.length}</span></div><div class="c4-needs">${att.map(card).join("")}</div></section>`;
  };
  const recent = () => {
    const S = H.S;
    if (!S.sessions.length) return "";
    const pool = H.recent().filter((s) => s.status !== "needs" && s.status !== "failed");
    const top = pool[0];
    const rest = pool.slice(1, H.compact ? 4 : 5);
    const hero =
      top &&
      (() => {
        const h = H.host(top.hostId);
        const off = h.status !== "online";
        return `<div class="c4-continue ${S.recentIds.includes(top.id) ? "row new" : ""}">${U.who(top)}<div class="grow"><div class="quiet small">Pick up where you left off · ${top.status === "running" ? "running now" : H.ago(top.ago) + " ago"}</div>
        <div class="c4-cont-t ell">${E(top.title)}</div><div class="rm ell">${E(top.preview)}</div><div class="rm ell">${U.meta(top)}</div></div>
        ${off ? `<button class="btn sm" data-a="reconnect" data-id="${h.id}">Reconnect</button>` : `<button class="btn sm solid" data-a="open-session" data-id="${top.id}">${top.kind === "chat" ? "Open chat" : "Open"} ${I("arrowRight", "sm")}</button>`}</div>`;
      })();
    return `<section id="c4-recent"><div class="sec-h"><h2>Recent</h2><div class="right"><span class="tabs">${[
      ["all", "All"],
      ["chat", "Chats"],
      ["agent", "Agents"],
    ]
      .map(
        ([k, t]) =>
          `<button class="${S.filter === k ? "on" : ""}" data-a="filter" data-id="${k}">${t}</button>`,
      )
      .join("")}</span>
      <button class="btn ghost sm" data-a="nav" data-id="History">History ${I("right", "sm")}</button></div></div>
      ${hero || ""}${rest.length ? `<div class="rows" style="margin-top:8px">${rest.map((s) => U.sessionRow(s)).join("")}</div>` : top ? "" : '<div class="empty">Nothing in this filter.</div>'}</section>`;
  };
  const upNext = () => {
    const S = H.S;
    const list = H.upcoming().filter((k) => !k.paused);
    if (!S.schedules.length) return "";
    const today = list.filter((k) => k.day === "Today");
    const later = list.filter((k) => k.day !== "Today").slice(0, 2);
    const paused = S.schedules.filter((k) => k.paused).length;
    const slot = (k) => {
      const off = H.host(k.hostId).status !== "online";
      return `<button class="c4-slot ${off ? "warn" : ""}" data-a="open-schedule" data-id="${k.id}"><span class="c4-at">${E(k.day === "Today" ? k.at : k.day === "Tomorrow" ? `Tmr ${k.at}` : `${k.day} ${k.at}`)}</span>
        <span class="grow"><span class="rt ell" style="display:block">${E(k.name)}</span><span class="rm ell" style="display:block">${I(k.kind === "Heartbeat" ? "pulse" : "automation", "sm")} ${E(k.target)} · ${off ? `${E(H.host(k.hostId).name)} offline` : `${E(H.hostLabel(H.host(k.hostId)))} · ${E(H.inText(k.inMin))}`}</span></span></button>`;
    };
    const nowAt = today.findIndex((k) => k.inMin > 0);
    return `<section id="c4-next"><div class="sec-h"><h2>Up next</h2><span class="sub">Schedules · heartbeats</span><div class="right"><button class="hbtn" data-a="nav" data-id="New schedule" title="New schedule">${I("plus")}</button></div></div>
      <div class="c4-tl">${today.map((k, i) => `${i === nowAt ? `<div class="c4-now"><span>${H.NOW}</span></div>` : ""}${slot(k)}`).join("")}${later.map(slot).join("")}</div>
      <div class="c4-foot quiet small">${paused ? `${paused} paused · ` : ""}Your time · UTC+7 <button class="link" data-a="nav" data-id="Automations">All automations</button></div></section>`;
  };
  const computers = () => {
    const S = H.S;
    if (S.hosts.length < 2 && S.hosts.every(H.online)) return "";
    return `<section><div class="sec-h"><h2>Computers</h2></div><div class="c4-hosts">${S.hosts
      .map(
        (
          h,
        ) => `<div class="c4-host">${I(H.hostIcon(h), "sm")}<span class="grow ell">${E(H.hostLabel(h))}<span class="quiet small"> · ${E(H.hostVia(h))}</span></span>
      ${h.status === "online" ? '<span class="dot ok" title="Online"></span>' : h.status === "offline" ? `<button class="link" data-a="reconnect" data-id="${h.id}">Reconnect</button>` : I("loader", "sm spin")}</div>`,
      )
      .join("")}
      <button class="c4-host add" data-a="sheet" data-sheet="pair">${I("plus", "sm")}<span>Connect a computer</span></button></div></section>`;
  };
  const greeting = (ctx) =>
    ctx.blocker?.kind === "mobile-pair"
      ? "Your agents, from your phone"
      : H.S.sessions.length
        ? "Good afternoon"
        : "What do you want to work on?";
  Object.assign(H.actions, {
    "c4-jump"(el) {
      requestAnimationFrame(() =>
        document
          .getElementById(`c4-${el.dataset.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    },
  });
  H.concept = {
    num: 4,
    name: "Home",
    tagline: "04 · Home — tổng hòa",
    render: (ctx) => {
      const S = H.S;
      const lower = `${needs()}${recent()}`;
      const rail = `${upNext()}${computers()}`;
      const hasActivity = S.sessions.length || S.schedules.length;
      return `<div class="c4 ${hasActivity ? "" : "fresh"}">
        <div class="c4-hero">
          <h1>${greeting(ctx)}</h1>${pulse()}${H.compact ? "" : contextBar(ctx)}
          ${stepper(ctx)}${U.notice(ctx)}
          ${H.compact ? "" : `${U.composer(ctx, { rows: 3 })}${U.starterHint(ctx)}`}
          ${U.setup(ctx)}${H.compact ? "" : starters(ctx)}${moreWays()}
          ${H.compact || !hasActivity ? "" : '<div class="c4-keys quiet small"><span class="kbd">/</span> focus · <span class="kbd">Enter</span> send · <span class="kbd">Shift Enter</span> new line · <span class="kbd">⌘K</span> search</div>'}
        </div>
        ${hasActivity ? (H.compact ? `<div class="c4-stack">${lower}${rail}</div>` : `<div class="c4-grid"><div class="c4-main">${lower}</div><aside class="c4-rail">${rail}</aside></div>`) : ""}
      </div>`;
    },
    bottom: (ctx) =>
      H.compact
        ? `<div class="c4-dock">${starters(ctx)}${U.composer(ctx, { ctxInside: true, rows: 1 })}${U.starterHint(ctx)}</div>`
        : "",
    notes: `<h2>04 · Home — tổng hòa</h2>
      <p><b>Ý tưởng:</b> Mở app là nhắn được ngay (01), luôn thấy và sửa được tin nhắn chạy ở máy nào (02), việc đang chờ bạn xử lý ngay trên Home và ngày làm việc nằm trên một timeline (03). Phần nào không có gì để nói thì không hiện.</p>
      <h3>Lấy từ ba hướng</h3>
      <table><tr><th>Từ</th><th>Lấy</th><th>Bỏ</th></tr>
      <tr><td>01 Start</td><td>Composer chính diện; gợi ý đổi theo ngữ cảnh; composer neo đáy trên mobile; Personal assistant cho tin đầu tiên.</td><td>Host chỉ là chip nhỏ trong composer (desktop).</td></tr>
      <tr><td>02 Hosts</td><td>Dòng <b>Runs on This Mac › clisbot</b> ngay trên composer; Connect a computer luôn một click; checklist lần đầu; Reconnect tại chỗ.</td><td>Hàng thẻ Host lớn đẩy composer xuống.</td></tr>
      <tr><td>03 Inbox</td><td>Needs you có Approve/Retry/Reconnect ngay; Up next dạng timeline với vạch Now.</td><td>Feed dài trộn mọi thứ; composer 1 dòng.</td></tr></table>
      <h3>Vượt hơn tổng ba hướng</h3><ul>
      <li><b>Pulse line</b> một dòng dưới lời chào: “2 need you · 1 running · Check channel health 15:50” — vừa là trạng thái vừa là lối tắt. Không cần ba ô số như dashboard.</li>
      <li><b>Pick up where you left off</b>: đúng một thẻ cho việc gần nhất (mở được, hoặc Reconnect nếu Host offline). Người quay lại có hai lựa chọn rõ: gõ việc mới hoặc tiếp tục.</li>
      <li><b>Lý do chọn ngữ cảnh</b> hiện cạnh Host/Project (“Last used 4m ago”, “Studio Mini is offline”, “Found on this computer”) → tự chọn nhưng không bí ẩn.</li>
      <li><b>Stepper 3 bước</b> thay cho trang onboarding: Connected → Agent ready → Say hello; tự biến mất sau tin đầu tiên. Bước 1 hiện đúng trạng thái đang khởi động/đang dò.</li>
      <li><b>Computers</b> chỉ hiện khi có nhiều máy hoặc có máy offline; một máy và online thì im lặng.</li>
      <li>“More ways to start” của Home hiện tại (folder, import session, tạo bot) giữ lại dạng dòng nhỏ, chỉ khi chưa có hoạt động.</li>
      <li>Phím tắt: <code>/</code> focus, Enter gửi, Shift+Enter xuống dòng, Esc đóng.</li></ul>
      <h3>Quy tắc Host/Project (chung 4 bản)</h3><ol style="padding-left:18px">
      <li>Lựa chọn thủ công trong draft hiện tại.</li><li>Lần gửi thành công gần nhất nếu Host online và Project còn.</li>
      <li>Host còn, Project mất → Project dùng gần nhất trên Host đó.</li>
      <li>Host offline → Host online khác, ưu tiên máy này trên Desktop/Web, rồi Project đã nhớ cho Host đó; báo rõ, giữ draft.</li>
      <li>Không còn gì → panel kết nối/thiết lập, giữ draft, khóa gửi.</li></ol>
      <p>Chỉ ghi nhớ sau khi gửi thành công. Session và lịch đã có <b>không bao giờ</b> bị chuyển Host; offline thì Reconnect. Chọn Bot thì dùng Host/Project của Bot.</p>
      <h3>Lần đầu</h3><ul>
      <li><b>Desktop</b>: máy này đã sẵn → gõ ngay; tin đầu tiên tạo Personal assistant (Bot, folder riêng). Muốn làm code thì chọn Project trong cùng dòng.</li>
      <li><b>Web</b>: tự dò localhost:6767 → tìm thấy thì chọn; không thấy → mở Desktop / lệnh CLI / Look again; bị chặn → cách bật Local network access. Luôn có Connect a computer.</li>
      <li><b>Mobile</b>: giải thích agent chạy trên máy tính, 3 bước Pair Device, quét QR hoặc dán link.</li></ul>
      <h3>Phạm vi</h3><p>Prototype tĩnh, dữ liệu mẫu, không gọi daemon. Khi làm thật: đặt trong <code>clisbot/home</code> sau một feature flag phía client; dùng owner hiện có của Chat, Agent session, Schedule và Pair Device; không đổi wire contract hay startup restore.</p>`,
  };
})();
