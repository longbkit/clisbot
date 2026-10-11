/* oxlint-disable no-nested-ternary, complexity -- prototype view templates read as one expression per state. */
/* 03 · Inbox — one feed of everything that happened and what waits on you, an agenda beside it. */
(() => {
  const { icon: I, esc: E, ui: U } = H;
  // Run results and host events the feed shows next to sessions (fixture only).
  const events = () => {
    const S = H.S;
    if (!S.sessions.length) return [];
    const out = [
      {
        type: "run",
        id: "e1",
        k: "k2",
        title: "Check channel health",
        text: "Heartbeat ran · all 3 channels healthy",
        ago: 30,
        hostId: "dev",
      },
      {
        type: "host",
        id: "e2",
        title: "Studio Mini went offline",
        text: "1 session and 1 upcoming run are on it",
        ago: 130,
        hostId: "studio",
      },
      {
        type: "run",
        id: "e3",
        k: "k1",
        title: "Daily standup summary",
        text: "Schedule ran · summary posted to the bot's chat",
        ago: 1310,
        hostId: "mac",
      },
    ];
    return out.filter(
      (e) => H.host(e.hostId) && (e.type !== "host" || H.host(e.hostId).status === "offline"),
    );
  };
  const feed = () => {
    const S = H.S;
    const f = S.c3f || "all";
    const att = H.attention().filter((a) => a.kind !== "offline");
    const sessions = H.recent("all").filter((s) => s.status !== "needs" && s.status !== "failed");
    let items = [...sessions.map((s) => ({ type: "session", s, ago: s.ago })), ...events()];
    if (f === "chat") items = items.filter((i) => i.s?.kind === "chat");
    if (f === "agent") items = items.filter((i) => i.s?.kind === "agent");
    if (f === "auto") items = items.filter((i) => i.type === "run");
    items.sort((a, b) => a.ago - b.ago);
    const groups = [
      ["Today", items.filter((i) => i.ago < 920)],
      ["Yesterday", items.filter((i) => i.ago >= 920)],
    ];
    const needCard = (a) => `<div class="c3-need">
      <div class="c3-need-h">${U.attnIcon(a)}<b class="grow ell">${E(a.title)}</b><span class="quiet small">${H.ago(a.ago)}</span></div>
      ${a.s ? `<div class="c3-ask">${a.kind === "needs" ? I("bell", "sm") : I("alert", "sm")}<span>${E(a.text)}</span></div><div class="rm">${U.meta(a.s)}</div>` : `<div class="rm">${E(a.text)}</div>`}
      <div class="acts">${U.attnActions(a)}${a.kind === "needs" ? `<button class="btn sm ghost" data-a="open-session" data-id="${a.s.id}">${I("reply", "sm")} Reply</button>` : ""}</div></div>`;
    const item = (i) => {
      if (i.type === "session") return U.sessionRow(i.s, { preview: true });
      return `<button class="row" data-a="${i.type === "run" ? "open-schedule" : "reconnect"}" data-id="${i.type === "run" ? i.k : i.hostId}"><span class="ri">${I(i.type === "run" ? "automation" : "offline")}</span>
        <span class="grow"><span class="rt ell" style="display:block">${E(i.title)}</span><span class="rm ell" style="display:block">${E(i.text)}</span></span>
        <span class="rr">${i.type === "host" ? '<span class="pill warn">Reconnect</span>' : '<span class="pill ok">Ran</span>'}<span>${H.ago(i.ago)}</span></span></button>`;
    };
    if (!S.sessions.length)
      return `<div class="c3-empty"><b>Your inbox fills up as you work</b><p>Chats, agent sessions, schedule runs and anything that needs your answer show up here, newest first.</p></div>`;
    return `<div class="c3-filters">${[
      ["all", "All"],
      ["chat", "Chats"],
      ["agent", "Agents"],
      ["auto", "Automations"],
    ]
      .map(
        ([k, t]) =>
          `<button class="c3-f ${f === k ? "on" : ""}" data-a="c3-filter" data-id="${k}">${t}</button>`,
      )
      .join("")}</div>
      ${att.length && (f === "all" || f === "agent") ? `<section><div class="sec-h"><h2>Needs you</h2><span class="pill warn">${att.length}</span></div><div class="c3-needs">${att.map(needCard).join("")}</div></section>` : ""}
      ${groups
        .filter(([, list]) => list.length)
        .map(
          ([g, list]) =>
            `<section><div class="sec-h"><h2>${g}</h2></div><div class="rows">${list.map(item).join("")}</div></section>`,
        )
        .join("")}`;
  };
  const agenda = () => {
    const S = H.S;
    const list = H.upcoming();
    if (!S.schedules.length)
      return `<section class="c3-rail-sec"><div class="sec-h"><h2>Agenda</h2></div><div class="empty">No schedules yet.<br><button class="link" data-a="nav" data-id="New schedule">Create a schedule</button></div></section>`;
    const today = list.filter((k) => !k.paused && k.day === "Today");
    const later = list.filter((k) => !k.paused && k.day !== "Today");
    const paused = list.filter((k) => k.paused);
    const slot = (k) => {
      const off = H.host(k.hostId).status !== "online";
      return `<button class="c3-slot ${off ? "warn" : ""}" data-a="open-schedule" data-id="${k.id}"><span class="c3-at">${E(k.at)}</span><span class="grow"><span class="rt ell" style="display:block">${E(k.name)}</span><span class="rm ell" style="display:block">${E(k.kind)} · ${off ? `${E(H.host(k.hostId).name)} offline` : E(H.inText(k.inMin) || k.day)}</span></span></button>`;
    };
    const nowAt = today.findIndex((k) => k.inMin > 0);
    return `<section class="c3-rail-sec"><div class="sec-h"><h2>Agenda</h2><span class="sub">Today · ${H.NOW}</span><div class="right"><button class="hbtn" data-a="nav" data-id="New schedule" title="New schedule">${I("plus")}</button></div></div>
      <div class="c3-tl">${today.map((k, i) => `${i === nowAt ? `<div class="c3-now"><span>Now ${H.NOW}</span></div>` : ""}${slot(k)}`).join("")}${nowAt === -1 ? `<div class="c3-now"><span>Now ${H.NOW}</span></div>` : ""}
      ${later.length ? `<div class="c3-day">Tomorrow and later</div>${later.map(slot).join("")}` : ""}
      ${paused.length ? `<div class="c3-day">Paused</div>${paused.map(slot).join("")}` : ""}</div></section>`;
  };
  const machines =
    () => `<section class="c3-rail-sec"><div class="sec-h"><h2>Computers</h2><div class="right"><button class="hbtn" data-a="sheet" data-sheet="pair" title="Connect a computer">${I("plus")}</button></div></div>
    ${H.S.hosts.map((h) => `<div class="c3-host">${I(H.hostIcon(h), "sm")}<span class="grow ell">${E(H.hostLabel(h))}</span>${h.status === "online" ? '<span class="dot ok"></span>' : h.status === "offline" ? `<button class="link" data-a="reconnect" data-id="${h.id}">Reconnect</button>` : `${I("loader", "sm spin")}`}</div>`).join("") || '<div class="quiet small">None yet.</div>'}</section>`;
  const compose = (ctx) => `<section class="c3-compose">
      <div class="c3-to"><span class="quiet small">To</span>${U.hostChip(ctx)}<span class="ctx-sep">›</span>${U.projectChip(ctx)}<span class="quiet small">${U.why(ctx)}</span></div>
      ${U.composer(ctx, { rows: 1 })}${U.starterHint(ctx)}${U.notice(ctx)}${U.setup(ctx)}</section>`;
  Object.assign(H.actions, {
    "c3-filter"(el) {
      H.S.c3f = el.dataset.id;
    },
    "c3-tab"(el) {
      H.S.c3tab = el.dataset.id;
    },
  });
  H.concept = {
    num: 3,
    name: "Inbox",
    tagline: "03 · Inbox — một dòng hoạt động, lịch bên cạnh",
    headerExtra: () => {
      const n = H.attention().length;
      return `<button class="hbtn" data-a="c3-tab" data-id="feed" title="Needs you">${I("inbox")}${n ? `<span class="count">${n}</span>` : ""}</button>`;
    },
    render: (ctx) => {
      if (H.compact) {
        const tab = H.S.c3tab === "agenda" ? "agenda" : "feed";
        return `<div class="c3">${compose(ctx)}<span class="tabs" style="align-self:flex-start">${[
          ["feed", "Inbox"],
          ["agenda", "Agenda"],
        ]
          .map(
            ([k, t]) =>
              `<button class="${tab === k ? "on" : ""}" data-a="c3-tab" data-id="${k}">${t}</button>`,
          )
          .join("")}</span>
          ${tab === "feed" ? feed() : `${agenda()}${machines()}`}</div>`;
      }
      return `<div class="c3-wrap"><div class="c3">${compose(ctx)}${feed()}</div><aside class="c3-rail">${agenda()}${machines()}</aside></div>`;
    },
    notes: `<h2>03 · Inbox</h2>
      <p><b>Ý tưởng:</b> Home là hộp thư công việc. Một dòng duy nhất gộp Chat, Agent session, kết quả lịch chạy và sự kiện Host; việc cần bạn trả lời luôn ở đầu, có nút xử lý ngay. Bên phải là lịch trong ngày.</p>
      <h3>Bố cục</h3><ul>
      <li>Composer gọn (1 dòng, tự giãn) ở đầu, dòng <b>To: This Mac › clisbot</b> ngay trên — đọc như địa chỉ người nhận email.</li>
      <li>Bộ lọc All / Chats / Agents / Automations. <b>Needs you</b>: thẻ có câu hỏi của agent + Approve / Reply / Open; lỗi có Retry.</li>
      <li>Rail phải: <b>Agenda</b> dạng timeline với vạch “Now 15:20”, ngày mai, Paused; dưới là <b>Computers</b> với Reconnect.</li>
      <li>Mobile: composer trên, hai tab Inbox / Agenda; badge số việc cần bạn trên header.</li></ul>
      <h3>Host &amp; lần đầu</h3><ul><li>Dùng chung bộ chọn và panel thiết lập; inbox rỗng giải thích nó sẽ chứa gì, không hiện “mọi thứ ổn” giả.</li></ul>
      <h3>Mạnh</h3><ul><li>Xử lý việc chờ nhanh nhất (duyệt ngay trên Home, không mở session).</li><li>Thấy được automation đã chạy gì và sắp chạy gì.</li></ul>
      <h3>Đánh đổi</h3><ul><li>Composer nhỏ, ít cảm giác “bắt đầu việc mới”.</li><li>Feed dài dễ thành nhiễu khi có nhiều automation; cần giới hạn và gộp.</li></ul>`,
  };
})();
