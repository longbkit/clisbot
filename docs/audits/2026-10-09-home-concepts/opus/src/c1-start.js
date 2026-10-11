/* oxlint-disable no-nested-ternary, complexity -- prototype view templates read as one expression per state. */
/* 01 · Start — the composer is the page. Context lives inside the composer; history stays quiet below. */
(() => {
  const { icon: I, esc: E, ui: U } = H;
  const starters = (ctx) =>
    ctx.target.kind === "starter" || ctx.target.kind === "bot"
      ? [
          ["Plan my week", "Help me plan my week. Ask me what's on my plate first."],
          ["Draft an email", "Draft a short email to "],
          ["Research a topic", "Research and compare "],
          ["Summarize a document", "Summarize the attached document in 5 bullets."],
        ]
      : [
          ["Fix a bug", "Find and fix the bug where "],
          ["Review my changes", "Review my uncommitted changes and point out risks."],
          [
            "Explain this project",
            "Give me a tour of this project: structure, entry points, how to run it.",
          ],
          ["Write a plan", "Write an implementation plan for "],
        ];
  const chips = (ctx) =>
    `<div class="c1-starters">${starters(ctx)
      .map(
        ([t, text]) =>
          `<button class="c1-chip" data-a="starter" data-text="${E(text)}">${t}</button>`,
      )
      .join("")}</div>`;
  const offlineLine = () =>
    H.attention()
      .filter((a) => a.kind === "offline")
      .map(
        (a) =>
          `<div class="c1-quiet-line">${I("offline", "sm")}<span class="grow ell">${E(a.title)} · ${E(a.text)}</span><button class="link" data-a="reconnect" data-id="${a.h.id}">Reconnect</button></div>`,
      )
      .join("");
  const jump = () => {
    const S = H.S;
    if (!S.sessions.length) return "";
    const rank = { needs: 0, failed: 1, running: 2, idle: 3 };
    const list = H.recent()
      .sort((a, b) => rank[a.status] - rank[b.status] || a.ago - b.ago)
      .slice(0, H.compact ? 5 : 6);
    return `<section class="c1-sec"><div class="sec-h"><h2>Jump back in</h2><div class="right"><span class="tabs">${[
      ["all", "All"],
      ["chat", "Chats"],
      ["agent", "Agents"],
    ]
      .map(
        ([k, t]) =>
          `<button class="${S.filter === k ? "on" : ""}" data-a="filter" data-id="${k}">${t}</button>`,
      )
      .join("")}</span></div></div>
      <div class="rows">${list.map((s) => U.sessionRow(s)).join("") || '<div class="empty">Nothing here yet.</div>'}</div>${offlineLine()}</section>`;
  };
  const upNext = () => {
    const list = H.upcoming()
      .filter((k) => !k.paused)
      .slice(0, 3);
    if (!list.length) return "";
    return `<section class="c1-sec"><div class="sec-h"><h2>Up next</h2><span class="sub">Schedules and heartbeats</span><div class="right"><button class="btn ghost sm" data-a="nav" data-id="Automations">All automations ${I("right", "sm")}</button></div></div>
      <div class="c1-next">${list
        .map((k) => {
          const off = H.host(k.hostId).status !== "online";
          return `<button class="c1-next-card" data-a="open-schedule" data-id="${k.id}"><span class="c1-time">${E(k.day === "Today" ? k.at : `${k.day} ${k.at}`)}</span><span class="rt ell">${E(k.name)}</span><span class="rm ell">${E(k.kind)} · ${E(H.hostLabel(H.host(k.hostId)))}</span>${off ? '<span class="pill warn">Host offline</span>' : `<span class="rm">${E(H.inText(k.inMin))}</span>`}</button>`;
        })
        .join("")}</div></section>`;
  };
  const failedRun = () =>
    H.attention()
      .filter((a) => a.kind === "run-failed")
      .map(
        (a) =>
          `<div class="notice warn">${I("alert")}<div class="grow"><b>${E(a.title)}</b> failed this morning: ${E(a.text)}</div><button class="btn sm" data-a="open-schedule" data-id="${a.k.id}">Open</button></div>`,
      )
      .join("");
  const hero = (ctx) => `
    <div class="c1-hero ${H.S.sessions.length ? "" : "fresh"}">
      ${H.compact ? "" : `<div class="c1-mark">${H.logo}</div>`}
      <h1>${ctx.blocker?.kind === "mobile-pair" ? "Your agents, from your phone" : "What do you want to work on?"}</h1>
      ${U.notice(ctx)}
      ${H.compact ? "" : `${U.composer(ctx, { ctxInside: true, rows: 3 })}${U.starterHint(ctx)}`}
      ${U.setup(ctx)}
      ${ctx.canSend && !H.compact ? chips(ctx) : ""}
    </div>`;
  H.concept = {
    num: 1,
    name: "Start",
    tagline: "01 · Start — composer là cả trang",
    render: (ctx) => `<div class="c1">${hero(ctx)}${failedRun()}${jump()}${upNext()}</div>`,
    bottom: (ctx) =>
      H.compact
        ? `<div class="c1-dock">${ctx.canSend ? chips(ctx) : ""}${U.composer(ctx, { ctxInside: true, rows: 1 })}${U.starterHint(ctx)}</div>`
        : "",
    notes: `<h2>01 · Start</h2>
      <p><b>Ý tưởng:</b> Home chính là một bản nháp tin nhắn mới. Mở app là gõ được ngay, giống màn hình chat hiện tại nhưng chưa có session.</p>
      <h3>Bố cục</h3><ul>
      <li>Desktop/Web: tiêu đề + composer giữa trang. <b>Host và Project nằm ngay trong thanh composer</b> (chip “This Mac › clisbot”), cạnh model, thinking, permissions.</li>
      <li>Gợi ý bắt đầu đổi theo ngữ cảnh: có Project → việc code; trợ lý cá nhân → việc viết/nghiên cứu.</li>
      <li>Bên dưới: <b>Jump back in</b> (Chat + Agent session, việc cần bạn xếp trước), Host offline là một dòng nhỏ, <b>Up next</b> là 3 thẻ lịch.</li>
      <li>Mobile: composer <b>neo đáy màn hình</b> như app chat; nội dung cuộn phía trên.</li></ul>
      <h3>Host &amp; lần đầu</h3><ul>
      <li>Desktop: tự chọn máy này, tin đầu tiên tạo <b>Personal assistant</b> (Bot có folder riêng) → không phải chọn thư mục trước.</li>
      <li>Web: dò localhost; không thấy/bị chặn → panel hướng dẫn ngay dưới composer. Mobile: 3 bước ghép nối QR/link.</li>
      <li>Fallback: thông báo phía trên composer, giữ draft, có “Change” và “Reconnect”.</li></ul>
      <h3>Mạnh</h3><ul><li>Ít quyết định nhất trước khi gửi; quen thuộc với người dùng ChatGPT/Claude.</li><li>Ít thay đổi so với composer hiện tại → dễ triển khai.</li></ul>
      <h3>Đánh đổi</h3><ul><li>Host chỉ là một chip nhỏ: dễ bỏ qua đang gửi lên máy nào khi có nhiều Host.</li><li>Việc cần chú ý không nổi bật nếu nhiều agent chạy cùng lúc.</li></ul>`,
  };
})();
