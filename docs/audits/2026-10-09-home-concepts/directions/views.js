HOME.view.directionTitle = () => {
  const d = HOME.directions[HOME.direction];
  const first = HOME.isFirst() || HOME.state.scenario === "localstarting";
  const title = first ? "Bắt đầu cùng Clisbot." : d.headline;
  return `<div class="direction-heading"><span class="welcome-label">${first ? "CHÀO ANH" : "HOME"}</span><h1 id="home-title">${title}</h1><p>${first ? "Agent chạy trên máy tính của anh. Kết nối Host và nhắn điều anh cần." : d.subtitle}</p></div>`;
};
HOME.view.hostTiles = () => {
  const rows = HOME.state.hosts.filter((h) => h.local || h.online);
  return `<div class="host-tiles" aria-label="Chọn máy tính chạy công việc">${rows.map((h) => `<button class="host-tile ${h.id === HOME.state.selectedHost ? "selected" : ""}" data-action="${h.online ? "pick-host" : "host-detail"}" data-id="${h.id}"><span class="tile-symbol">${HOME.icon(h.local ? "host" : "remote")}</span><span><strong>${h.local ? "Local · Máy này" : HOME.esc(h.name)}</strong><small>${h.local ? "Bắt đầu trên máy đang dùng" : "Remote · Máy tính từ xa"}</small></span><span class="tile-state"><span class="dot ${h.online ? "online" : ""}"></span>${h.id === HOME.state.selectedHost ? HOME.icon("check") : ""}</span></button>`).join("")}<button class="host-tile add-tile" data-action="connect">${HOME.icon("plus")}<span><strong>Thêm remote Host</strong><small>Làm việc từ thiết bị khác</small></span></button></div>`;
};
HOME.view.hostDock = () => {
  const info = HOME.directionHostInfo();
  const onboarding = HOME.directionBase.onboarding();
  return `<aside class="host-dock ${info.ready ? "ready" : "needs-setup"} ${info.host ? "" : "unconnected"}" aria-label="Kết nối Host và ngữ cảnh">
    <div class="dock-heading"><span>${HOME.icon("host")}Nơi chạy công việc</span><button class="icon-button" data-action="host-guide" aria-label="Hướng dẫn Host">${HOME.icon("help")}</button></div>
    <button class="dock-host" data-action="${info.host ? "hosts" : "connect"}"><span class="dock-machine">${HOME.icon(info.host?.local ? "host" : "remote")}</span><span><strong>${HOME.esc(info.title)}</strong><small>${HOME.esc(info.subtitle)}</small></span>${HOME.icon("down")}</button>
    <div class="dock-status"><span class="dot ${info.host?.online ? "online" : ""}"></span>${info.status}</div>
    <div class="dock-origin">${info.origin}</div>
    ${info.host ? `<button class="dock-project" data-action="projects">${HOME.icon("project")}<span><small>Project</small><strong>${HOME.esc(info.projectName)}</strong>${info.project ? `<small>${HOME.esc(info.project.path)}</small>` : ""}</span>${HOME.icon("down")}</button>` : ""}
    ${info.ready && !onboarding ? `<div class="dock-detail">${HOME.icon("check")}<span>${info.detail}</span></div>` : ""}
    ${onboarding ? `<div class="dock-onboarding">${onboarding}</div>` : ""}
    <button class="dock-connect" data-action="connect">${HOME.icon("plus")}Kết nối remote Host${HOME.icon("right")}</button>
    <button class="dock-footer" data-action="context">Kiểm tra ngữ cảnh ${HOME.icon("right")}</button>
  </aside>`;
};
HOME.view.workSummary = () => {
  const p = HOME.projects[HOME.state.selectedProject];
  const sessions = HOME.state.sessions.filter(
    (s) => s.host === HOME.state.selectedHost && s.project === HOME.state.selectedProject,
  );
  const count = sessions.filter((s) => s.status === "running").length;
  return `<aside class="project-summary"><span class="welcome-label">PROJECT ĐANG CHỌN</span><div class="project-summary-name">${p ? HOME.view.projectMark(HOME.state.selectedProject) : HOME.icon("project")}<strong>${HOME.esc(p?.name || "Project đầu tiên")}</strong></div><p>${HOME.esc(p?.path || "Chat có Project riêng; Agent session cần thư mục làm việc.")}</p><button data-action="workspace-context">${HOME.icon("branch")}Workspace mặc định ${HOME.icon("right")}</button><div class="project-summary-counts"><span><strong>${sessions.length}</strong> session gần đây</span><span><strong>${count}</strong> đang chạy</span></div><button class="text-action" data-action="projects">Đổi Project ${HOME.icon("down")}</button></aside>`;
};
HOME.view.quickStarts = () => {
  const ids = HOME.state.launchpad;
  return `<section class="quick-starts" aria-label="Gợi ý bắt đầu"><div class="quick-start-title"><span>Thử bắt đầu với</span><button data-action="launchpad">Tất cả gợi ý ${HOME.icon("right")}</button></div><div class="quick-start-grid">${ids
    .map((id) => {
      const s = HOME.starters[id];
      return `<button data-action="starter" data-id="${id}" class="quick-start ${HOME.state.focusedStarter === id ? "selected" : ""}">${HOME.icon(s.icon)}<span><strong>${s.title}</strong><small>${s.subtitle}</small></span>${HOME.icon("right")}</button>`;
    })
    .join("")}</div></section>`;
};
HOME.view.session = (s) => {
  const host = HOME.state.hosts.find((h) => h.id === s.host);
  return `<button class="session-row" data-action="session" data-id="${s.id}"><span class="session-mark ${s.color}">${s.type === "chat" ? HOME.esc(s.avatar) : HOME.providerIcon(s.provider)}</span><span class="session-body"><span class="session-top"><strong>${HOME.esc(s.title)}</strong><span class="session-type">${s.type === "chat" ? "Chat" : "Agent session"}</span></span><span class="session-preview">${HOME.esc(s.preview)}</span><span class="session-meta">${HOME.esc(HOME.projects[s.project].name)} · ${host?.local ? "Local" : HOME.esc(host?.name || "Host không khả dụng")} · ${HOME.esc(s.type === "chat" ? s.bot : s.provider)}</span></span><span class="session-tail">${HOME.view.status(s)}<small>${s.time === "Đang chạy" ? "Vừa cập nhật" : s.time}</small></span>${HOME.icon("right")}</button>`;
};
HOME.view.recentFilters = () =>
  `<div class="recent-toolbar"><div class="filters" role="group" aria-label="Loại session">${[
    ["all", "Tất cả"],
    ["chat", "Chat"],
    ["agent", "Agent session"],
  ]
    .map(
      ([id, label]) =>
        `<button data-action="filter" data-id="${id}" class="${HOME.state.filter === id ? "active" : ""}" aria-pressed="${HOME.state.filter === id}">${label}</button>`,
    )
    .join(
      "",
    )}</div>${[2, 4].includes(HOME.direction) ? `<button class="scope-toggle" data-action="activity-scope">${HOME.icon("project")}${HOME.state.activityScope === "project" ? "Project này" : "Mọi Project"}${HOME.icon("down")}</button>` : `<button class="icon-button" data-action="search" aria-label="Tìm session">${HOME.icon("search")}</button>`}</div>`;
HOME.view.recent = () => {
  const sessions = HOME.directionSessions();
  const limit = HOME.direction === 3 ? 3 : 4;
  const visible = sessions.slice(0, HOME.state.showAll ? 20 : limit);
  let body = visible.map(HOME.view.session).join("");
  if (HOME.direction === 2 && visible.length) {
    const groups = [...new Set(visible.map((s) => `${s.host}:${s.project}`))];
    body = groups
      .map((key) => {
        const [host, project] = key.split(":");
        const h = HOME.state.hosts.find((v) => v.id === host);
        return `<div class="project-session-group"><div class="project-group-heading">${HOME.view.projectMark(project)}<strong>${HOME.esc(HOME.projects[project].name)}</strong><span>${h?.local ? "Local · Máy này" : HOME.esc(h?.name || "Host không khả dụng")}</span></div>${visible
          .filter((s) => s.host === host && s.project === project)
          .map(HOME.view.session)
          .join("")}</div>`;
      })
      .join("");
  }
  if (!visible.length)
    body = HOME.view.empty(
      "chat",
      "Sẵn sàng cho việc đầu tiên",
      HOME.state.activityScope === "project"
        ? "Chưa có session trong Project này. Anh có thể bắt đầu mới hoặc xem mọi Project."
        : "Chat và Agent session của anh sẽ xuất hiện ở đây.",
      "focus-prompt",
      "Viết tin nhắn",
    );
  if (HOME.isLoading()) body = '<div class="skeleton"></div><div class="skeleton"></div>';
  return `<section class="recent-area"><div class="section-header"><div><h2>${HOME.direction === 3 ? "Tiếp tục công việc" : "Gần đây"}</h2><div class="section-subtitle">${HOME.direction === 2 ? "Nhóm theo Host và Project" : "Chat và Agent session trên các Host của anh"}</div></div><button class="text-action" data-action="history">Xem tất cả ${HOME.icon("right")}</button></div>${HOME.view.recentFilters()}${HOME.state.query ? `<div class="query-label">Tìm “${HOME.esc(HOME.state.query)}” <button data-action="clear-search">Xóa lọc</button></div>` : ""}<div class="direction-sessions">${body}</div>${sessions.length > visible.length ? '<button class="more-sessions" data-action="show-all">Xem thêm session ↓</button>' : ""}</section>`;
};
HOME.view.attention = (options = {}) => {
  if (HOME.isLoading()) return "";
  const waiting = HOME.state.sessions.filter(
    (s) => s.status === "attention" && HOME.state.hosts.find((h) => h.id === s.host)?.online,
  );
  const rows = options.skipPriority ? waiting.slice(1) : waiting;
  const down = HOME.state.hosts.filter((h) => !h.online);
  const showDown = down.length && !HOME.isFirst() && HOME.state.scenario !== "localstarting";
  const items = rows
    .map(
      (s) =>
        `<button class="attention-action" data-action="session" data-id="${s.id}"><span class="attention-symbol">${HOME.icon("chat")}</span><span><strong>${HOME.esc(s.title)}</strong><small>${s.provider} · cần anh xem đề xuất</small><em>Mở để phản hồi ${HOME.icon("right")}</em></span></button>`,
    )
    .join("");
  const offline = showDown
    ? `<button class="attention-action offline-action" data-action="hosts"><span class="attention-symbol">${HOME.icon("host")}</span><span><strong>${down.length} Host đang offline</strong><small>${down.map((h) => HOME.esc(h.name)).join(", ")}</small><em>Kiểm tra kết nối ${HOME.icon("right")}</em></span></button>`
    : "";
  return `<section class="attention-card"><div class="attention-heading">${HOME.icon(rows.length ? "bell" : "check")}${HOME.direction === 3 ? "Cần phản hồi" : "Cần chú ý"}${rows.length ? `<span class="count">${rows.length}</span>` : ""}</div>${items}${offline}${!items && !offline ? '<div class="all-clear">Mọi thứ đang ổn.<small>Việc cần phản hồi sẽ xuất hiện ở đây.</small></div>' : ""}</section>`;
};
HOME.view.priority = () => {
  const item = HOME.state.sessions.find(
    (s) => s.status === "attention" && HOME.state.hosts.find((h) => h.id === s.host)?.online,
  );
  if (!item) return "";
  return `<button class="priority-inline" data-action="session" data-id="${item.id}">${HOME.icon("bell")}<span><strong>Đang chờ anh</strong> ${HOME.esc(item.title)}</span><span class="priority-cta">Xem đề xuất ${HOME.icon("right")}</span></button>`;
};
HOME.view.scheduleRow = (s) => {
  const host = HOME.state.hosts.find((h) => h.id === s.host);
  let next = HOME.esc(s.relative);
  if (!host?.online) next = "Host offline · cần kết nối lại";
  if (s.paused) next = "Tạm dừng";
  return `<button class="schedule-row" data-action="schedule" data-id="${s.id}"><span class="schedule-time">${HOME.esc(s.time)}</span><span class="schedule-copy"><strong>${HOME.esc(s.title)}</strong><span class="schedule-meta">${HOME.esc(HOME.projects[s.project].name)} · ${host?.local ? "Local" : HOME.esc(host?.name || "Host không khả dụng")}</span><span class="schedule-next"><span class="schedule-label">${s.type}</span>${next}</span></span>${HOME.icon("right")}</button>`;
};
HOME.view.schedules = () => {
  const items = HOME.state.schedules.filter((s) => !s.paused);
  const body = ["Hôm nay", "Ngày mai"]
    .map((day) => {
      const group = items.filter((s) => s.day === day).sort((a, b) => a.time.localeCompare(b.time));
      return group.length
        ? `<div class="schedule-group">${day}<small>Asia/Ho_Chi_Minh · UTC+7</small></div>${group.map(HOME.view.scheduleRow).join("")}`
        : "";
    })
    .join("");
  return `<section class="schedule-section"><div class="section-header"><div><h2>Sắp chạy tiếp theo</h2><div class="section-subtitle">Schedule và Heartbeat</div></div><button class="icon-button" data-action="new-schedule" aria-label="Tạo lịch">${HOME.icon("plus")}</button></div><div class="schedule-card">${HOME.isLoading() ? '<div class="skeleton"></div>' : body || HOME.view.empty("clock", "Chưa có lịch", "Hẹn một công việc định kỳ khi anh cần.", "new-schedule", "Tạo lịch")}</div><button class="text-action schedule-all" data-action="automations">Xem tất cả lịch ${HOME.icon("right")}</button></section>`;
};
