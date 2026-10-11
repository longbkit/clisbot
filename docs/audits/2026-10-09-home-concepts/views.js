/* Presentation only. Concept layouts share the same context and action model. */
HOME.view = {};
HOME.view.status = (session) => {
  const host = HOME.state.hosts.find((item) => item.id === session.host);
  const status = !host?.online ? "offline" : session.status;
  const [label, color] = HOME.status[status];
  return `<span class="status ${color}"><span class="dot"></span>${label}</span>`;
};
HOME.view.projectMark = (id) => {
  const project = HOME.projects[id];
  return project
    ? `<span class="project-mark ${project.color}">${HOME.esc(project.letter)}</span>`
    : "";
};
HOME.view.nav = (action, icon, label, active = false) =>
  `<button class="nav-button ${active ? "active" : ""}" data-action="${action}" title="${label}">${HOME.icon(icon)}<span class="nav-label">${label}</span>${action === "search" ? "<kbd>⌘ K</kbd>" : ""}</button>`;
HOME.view.sidebar = () => {
  const state = HOME.state;
  const projects = [...new Set(state.hosts.flatMap((host) => host.projects))];
  const accessible = projects
    .map(
      (id) =>
        `<button class="side-project ${state.selectedProject === id ? "selected" : ""}" data-action="side-project" data-id="${id}">${HOME.view.projectMark(id)}<span>${HOME.esc(HOME.projects[id].name)}<span class="side-meta">${state.sessions.filter((s) => s.project === id).length} session gần đây</span></span></button>`,
    )
    .join("");
  return `<aside class="sidebar"><div class="brand"><span class="logo">${HOME.logo}</span><span class="brand-name">clisbot</span></div>
    <button class="account" data-action="account"><span class="avatar">L</span><span class="account-copy">Không gian của Long<small>Cá nhân</small></span>${HOME.icon("down")}</button>
    <nav aria-label="Điều hướng">${HOME.view.nav("home", "home", "Home", true)}${HOME.view.nav("search", "search", "Tìm kiếm")}${HOME.view.nav("history", "clock", "Lịch sử")}${HOME.view.nav("automations", "bolt", "Automations")}</nav>
    <div class="side-heading">PROJECTS<button data-action="add-project" aria-label="Thêm Project">${HOME.icon("plus")}</button></div>${accessible}
    <div class="side-heading">ĐÃ GHIM</div><button class="side-project" data-action="pin"><span class="avatar ocean">PA</span><span>Product assistant</span></button>
    <div class="side-footer">${HOME.view.nav("hosts", "host", "Hosts")}${HOME.view.nav("help", "help", "Trợ giúp")}${HOME.view.nav("settings", "settings", "Cài đặt")}
    <div class="side-connection"><span class="dot ${state.hosts.some((host) => host.online) ? "online" : ""}"></span>${state.hosts.filter((host) => host.online).length} Host đang online<button data-action="connect">+ Thêm remote Host</button></div></div></aside>`;
};
HOME.view.topbar = () => {
  const host = HOME.selectedHost();
  return `<header class="topbar"><div class="breadcrumb"><button class="icon-button mobile-menu" data-action="mobile-menu" aria-label="Mở điều hướng">${HOME.icon("menu")}</button>Không gian của Long<span class="slash">/</span><strong>Home</strong></div>
    <div class="top-actions"><span class="top-host"><span class="dot ${host?.online ? "online" : ""}"></span>${host ? HOME.esc(host.name) : "Chưa kết nối Host"}</span><button class="icon-button" data-action="attention" aria-label="Xem các việc cần chú ý">${HOME.icon("bell")}</button><button class="avatar top-avatar" data-action="account" aria-label="Tài khoản của Long">L</button></div></header>`;
};
HOME.view.notice = () => {
  const notice = HOME.state.notice;
  if (!notice || HOME.state.dismissed) return "";
  return `<div class="notice" role="status">${HOME.icon("info")}<div class="notice-copy"><strong>${HOME.esc(notice.title)}</strong><p>${HOME.esc(notice.text)}</p><button class="text-action" data-action="${notice.key}">${HOME.esc(notice.action)} ${HOME.icon("right")}</button></div><button class="notice-close" data-action="dismiss" aria-label="Ẩn thông báo">${HOME.icon("close")}</button></div>`;
};
HOME.view.onboardCard = (icon, title, copy, actions) =>
  `<section class="onboarding"><div class="onboard-icon">${HOME.icon(icon)}</div><div class="onboard-body"><h2>${title}</h2><p>${copy}</p><div class="onboard-actions">${actions}</div></div></section>`;
HOME.view.onboarding = () => {
  const state = HOME.state;
  const host = HOME.selectedHost();
  const action = (name, label) =>
    `<button class="outline-button" data-action="${name}">${label} ${HOME.icon("right")}</button>`;
  const remote = '<button class="text-action" data-action="connect">Thêm remote Host ↗</button>';
  if (HOME.isLoading())
    return HOME.view.onboardCard(
      "clock",
      "Đang khôi phục ngữ cảnh của anh",
      "Đang chờ Host và danh sách Project. Bản nháp vẫn được giữ, ngữ cảnh sẽ được xác định khi dữ liệu sẵn sàng.",
      action("finish-loading", "Mô phỏng tải xong"),
    );
  if (state.scenario === "firstdesktop" && !state.localStarted && !state.connected)
    return HOME.view.onboardCard(
      "host",
      "Bắt đầu trên máy tính này",
      "Clisbot Desktop đã tìm thấy Host local. Chuẩn bị provider và chọn Project để bắt đầu cuộc trò chuyện đầu tiên.",
      action("local-setup", "Thiết lập Host local") + remote,
    );
  if (state.scenario === "firstweb" && !state.localFound && !state.connected)
    return HOME.view.onboardCard(
      "host",
      "Kết nối máy tính anh đang dùng",
      "Web sẽ ưu tiên Host local khi tìm thấy. Nếu Host chưa chạy hoặc trình duyệt không thể kết nối, anh có thể kết nối thủ công hay dùng remote Host.",
      action("find-local", "Tìm Host local") + remote,
    );
  if (state.scenario === "firstmobile" && !state.connected)
    return HOME.view.onboardCard(
      "phone",
      "Đưa máy tính của anh vào túi",
      "Agent chạy trên máy tính. Kết nối một remote Host để chat, theo dõi session và tiếp tục công việc từ điện thoại.",
      action("connect", "Kết nối remote Host"),
    );
  if (!state.hosts.some((item) => item.online))
    return HOME.view.onboardCard(
      "link",
      "Chưa có Host nào online",
      "Bản nháp của anh vẫn ở đây. Kết nối lại Host để gửi; các session cũ giữ đúng Host của chúng.",
      action("reconnect", "Kết nối lại") + remote,
    );
  if (!host?.projects.length)
    return HOME.view.onboardCard(
      "project",
      "Host sẵn sàng. Thêm Project đầu tiên.",
      "Chọn nơi làm việc trên Host để các cuộc trò chuyện và Agent session có đúng ngữ cảnh.",
      action("add-project", "Thêm Project"),
    );
  if (!host.ready)
    return HOME.view.onboardCard(
      "terminal",
      "Cần chuẩn bị một provider",
      `${HOME.esc(host.name)} đã online. Cài hoặc đăng nhập Claude Code, Codex hay provider anh muốn dùng để bắt đầu.`,
      action("provider-setup", "Chuẩn bị provider"),
    );
  if (HOME.isFirst())
    return HOME.view.onboardCard(
      "check",
      "Mọi thứ đã sẵn sàng cho cuộc trò chuyện đầu tiên",
      `Đã chọn ${HOME.esc(host.name)} · ${HOME.esc(HOME.projects[state.selectedProject].name)}. Anh có thể đổi ngữ cảnh ngay trong ô chat.`,
      remote + action("add-project", "Thêm Project khác"),
    );
  return "";
};
HOME.view.composer = () => {
  const state = HOME.state;
  const host = HOME.selectedHost();
  const project = HOME.projects[state.selectedProject];
  const bot = HOME.selectedBot();
  const ready = HOME.canSend();
  const disabled = ready ? "" : "disabled";
  const chip = (action, icon, label, value) =>
    `<button class="context-chip" data-action="${action}" aria-label="${label}: ${HOME.esc(value)}" ${HOME.isLoading() ? "disabled" : ""}>${HOME.icon(icon)}<strong>${HOME.esc(value)}</strong>${HOME.icon("down", "chevron")}</button>`;
  const target =
    state.mode === "chat"
      ? chip("bots", "chat", "Bot", bot?.name || "Chọn Bot")
      : chip("providers", "terminal", "Provider", state.provider);
  const files = state.files
    .map(
      (file, i) =>
        `<span class="file-chip">${HOME.icon("attach")}${HOME.esc(file)}<button data-action="remove-file" data-id="${i}" aria-label="Bỏ tệp ${HOME.esc(file)}">${HOME.icon("close")}</button></span>`,
    )
    .join("");
  return `<div class="composer"><div class="compose-heading"><div class="mode-tabs" role="group" aria-label="Cách bắt đầu"><button data-action="mode-chat" class="${state.mode === "chat" ? "active" : ""}" aria-pressed="${state.mode === "chat"}">${HOME.icon("chat")}Chat với Bot</button><button data-action="mode-agent" class="${state.mode === "agent" ? "active" : ""}" aria-pressed="${state.mode === "agent"}">${HOME.icon("terminal")}Agent session</button></div><span class="private-label">${HOME.icon("shield")}Chạy trên Host của anh</span></div>
    <textarea id="prompt" aria-label="Tin nhắn mới" placeholder="${state.mode === "chat" ? "Anh đang nghĩ gì? Cùng mình làm rõ nhé…" : "Mô tả việc anh muốn agent thực hiện…"}">${HOME.esc(state.draft)}</textarea>
    <div class="file-chips">${files}</div><div class="composer-bottom"><div class="context-chips">${chip("hosts", host?.local ? "host" : "remote", "Host", host?.name || "Chọn Host")}${chip("projects", "project", "Project", project?.name || "Chọn Project")}${target}</div><div class="send-area"><button class="icon-button" data-action="attach" aria-label="Đính kèm tệp">${HOME.icon("attach")}</button><button class="icon-button" data-action="voice" aria-label="Nhập bằng giọng nói">${HOME.icon("mic")}</button><button id="send" class="send-button" data-action="send" aria-label="Gửi và bắt đầu ${state.mode === "chat" ? "Chat" : "Agent session"}" ${disabled || (!state.draft.trim() ? "disabled" : "")}>${HOME.icon("arrow")}</button></div></div></div>
    <div class="composer-context">${HOME.icon(ready ? "check" : "info")}<span>${HOME.view.contextCopy()}</span><button data-action="context">${HOME.icon("settings")} Ngữ cảnh</button></div>
    <div class="suggestions"><button class="suggestion" data-action="suggest" data-id="plan">${HOME.icon("bolt")}Lên kế hoạch một ý tưởng</button><button class="suggestion" data-action="suggest" data-id="review">${HOME.icon("terminal")}Review thay đổi mới</button><button class="suggestion" data-action="suggest" data-id="summary">${HOME.icon("clock")}Tóm tắt việc đang mở</button></div>`;
};
HOME.view.contextCopy = () => {
  if (HOME.isLoading()) return "Đang xác định ngữ cảnh · giữ nguyên bản nháp";
  const host = HOME.selectedHost();
  if (!host?.online) return "Cần Host online để bắt đầu · bản nháp được giữ";
  if (!HOME.state.selectedProject) return "Thêm Project trước khi gửi";
  if (!host.ready) return "Provider chưa sẵn sàng · cần cài hoặc đăng nhập";
  if (HOME.state.mode === "chat")
    return `Chat mới với ${HOME.esc(HOME.selectedBot()?.name || "Bot chưa được chọn")} · dùng ngữ cảnh của Bot`;
  return `Session mới · Workspace mặc định của ${HOME.esc(HOME.projects[HOME.state.selectedProject].name)} · ${HOME.esc(HOME.state.provider)}`;
};
HOME.view.hero = () => {
  const state = HOME.state;
  const concept = HOME.concepts[state.concept];
  const first = HOME.isFirst();
  const title = first ? "Chào anh, bắt đầu cùng Clisbot." : concept.headline;
  const subtitle = first
    ? "Kết nối một Host. Chọn Project. Rồi cứ nhắn điều anh cần."
    : concept.subtitle;
  const project = HOME.projects[state.selectedProject];
  const context =
    state.concept === "workspace" && project
      ? `<div class="project-context">${HOME.view.projectMark(state.selectedProject)}<strong>${HOME.esc(project.name)}</strong><span>·</span><span>${HOME.esc(project.path)}</span><button data-action="workspace-context">${HOME.icon("branch")} Workspace mặc định ↗</button></div>`
      : "";
  return `<section class="hero" aria-labelledby="home-title"><div class="hero-title-row"><div><div class="eyebrow">${concept.tag}</div><h1 id="home-title">${title}</h1><p class="hero-subtitle">${subtitle}</p></div>${state.concept === "pulse" ? '<div class="pulse-date">THỨ SÁU<strong>09 / 10</strong>2026</div>' : `<div class="hero-emblem"><span class="logo">${HOME.logo}</span></div>`}</div>${HOME.view.notice()}${HOME.view.onboarding()}${HOME.view.composer()}${context}</section>`;
};
HOME.view.session = (session) => {
  const project = HOME.projects[session.project];
  const host = HOME.state.hosts.find((item) => item.id === session.host);
  return `<button class="session-row" data-action="session" data-id="${session.id}"><span class="session-mark ${session.color}">${session.type === "chat" ? HOME.esc(session.avatar) : HOME.icon("terminal")}</span><span class="session-body"><span class="session-top"><strong>${HOME.esc(session.title)}</strong><span class="session-type">${session.type === "chat" ? "Chat" : "Agent"}</span></span><span class="session-preview">${HOME.esc(session.preview)}</span><span class="session-meta"><span>${HOME.esc(project.name)}</span><span>·</span><span>${HOME.esc(host?.name || "Host không khả dụng")}</span><span>·</span><span>${session.type === "chat" ? HOME.esc(session.bot) : HOME.esc(session.provider)}</span></span></span><span class="session-tail">${HOME.view.status(session)}<br /><span>${session.time}</span></span></button>`;
};
HOME.view.filteredSessions = () =>
  HOME.state.sessions
    .filter(
      (session) =>
        (HOME.state.filter === "all" || session.type === HOME.state.filter) &&
        `${session.title} ${HOME.esc(HOME.projects[session.project].name)} ${session.bot || ""} ${session.provider}`
          .toLowerCase()
          .includes(HOME.state.query.toLowerCase()),
    )
    .sort((a, b) => b.stamp - a.stamp);
HOME.view.empty = (icon, title, copy, action, label) =>
  `<div class="empty-state">${HOME.icon(icon)}<h3>${title}</h3><p>${copy}</p>${action ? `<button class="outline-button" data-action="${action}">${label}</button>` : ""}</div>`;
HOME.view.recent = () => {
  const state = HOME.state;
  const sessions = HOME.view.filteredSessions();
  const visible = sessions.slice(0, state.showAll ? 20 : 4);
  let rows = visible.map(HOME.view.session).join("");
  if (state.concept === "workspace" && visible.length)
    rows = [...new Set(visible.map((s) => s.project))]
      .map(
        (id) =>
          `<div class="group-label">${HOME.view.projectMark(id)}${HOME.esc(HOME.projects[id].name)}</div><div class="session-list">${visible
            .filter((s) => s.project === id)
            .map(HOME.view.session)
            .join("")}</div>`,
      )
      .join("");
  if (state.concept === "pulse" && visible.length)
    rows = `<div class="timeline-list">${visible.map((session) => `<div class="time-label">${session.time}</div>${HOME.view.session(session)}`).join("")}</div>`;
  if (!visible.length)
    rows = HOME.view.empty(
      "chat",
      state.query ? "Chưa tìm thấy session phù hợp" : "Cuộc trò chuyện đầu tiên bắt đầu ở đây",
      state.query
        ? "Thử tên session, Bot hoặc Project khác."
        : "Nhắn một ý tưởng ở ô chat phía trên. Các Chat và Agent session gần đây sẽ xuất hiện ở đây.",
      state.query ? "clear-search" : "focus-prompt",
      state.query ? "Xóa tìm kiếm" : "Viết tin nhắn đầu tiên",
    );
  if (HOME.isLoading())
    rows =
      '<div class="skeleton"></div><div class="skeleton"></div><div class="loading-message">Đang tải session gần đây…</div>';
  let classes = "session-list";
  if (state.concept === "workspace") classes = "";
  if (state.concept === "focus" && visible.length) classes = "recent-cards";
  return `<section class="recent-area"><div class="section-header"><div><h2>${state.concept === "pulse" ? "Dòng hoạt động gần đây" : "Tiếp tục công việc"}</h2><div class="section-subtitle">Chat và Agent session · từ các Host anh có quyền</div></div><button class="text-action" data-action="history">Lịch sử ${HOME.icon("right")}</button></div><div class="filters" role="group" aria-label="Lọc session">${[
    ["all", "Tất cả"],
    ["chat", "Chat"],
    ["agent", "Agent session"],
  ]
    .map(
      ([key, label]) =>
        `<button data-action="filter" data-id="${key}" class="${state.filter === key ? "active" : ""}" aria-pressed="${state.filter === key}">${label}</button>`,
    )
    .join(
      "",
    )}<button class="filter-search" data-action="search" aria-label="Tìm session">${HOME.icon("search")}</button></div>${state.query ? `<div class="time-label">Kết quả cho “${HOME.esc(state.query)}” · <button class="text-action" data-action="clear-search">Xóa lọc</button></div>` : ""}<div class="${classes}">${rows}</div>${sessions.length > 4 && !state.showAll ? '<button class="text-action" data-action="show-all" style="margin-top:12px">Xem thêm session ↓</button>' : ""}</section>`;
};
HOME.view.attention = () => {
  const state = HOME.state;
  if (HOME.isLoading()) return "";
  const needing = state.sessions.filter(
    (s) => s.status === "attention" && state.hosts.find((h) => h.id === s.host)?.online,
  );
  const hostDown = state.hosts.some((h) => !h.online) && !HOME.isFirst();
  if (!needing.length && !hostDown)
    return `<section class="attention-card"><div class="attention-heading">${HOME.icon("check")}Mọi thứ đang ổn</div><div class="attention-item"><p>Chưa có việc cần anh phản hồi. Clisbot sẽ đưa chúng lên đây khi cần.</p></div></section>`;
  const rows = needing
    .slice(0, 2)
    .map(
      (s) =>
        `<div class="attention-item">${HOME.icon("chat")}<div><strong>${HOME.esc(s.title)}</strong><p>${HOME.esc(s.provider)} cần anh xem đề xuất để tiếp tục.</p><button data-action="session" data-id="${s.id}">Mở để phản hồi ${HOME.icon("right")}</button></div></div>`,
    )
    .join("");
  return `<section class="attention-card"><div class="attention-heading">${HOME.icon("bell")}Cần chú ý<span class="count">${needing.length + (hostDown ? 1 : 0)}</span></div>${rows}${hostDown ? `<div class="attention-item">${HOME.icon("host")}<div><strong>${state.hosts.filter((h) => !h.online).length} Host đang offline</strong><p>Session trên các Host này chưa thể tiếp tục.</p><button data-action="hosts">Xem Hosts ${HOME.icon("right")}</button></div></div>` : ""}</section>`;
};
HOME.view.scheduleRow = (schedule) => {
  const host = HOME.state.hosts.find((h) => h.id === schedule.host);
  let next = schedule.relative;
  if (!host?.online) next = "Host offline · có thể lỡ lịch";
  if (schedule.paused) next = "Đã tạm dừng";
  return `<button class="schedule-row" data-action="schedule" data-id="${schedule.id}"><span class="schedule-time">${HOME.esc(schedule.time)}</span><span class="schedule-copy"><strong>${HOME.esc(schedule.title)}</strong><span class="schedule-meta">${HOME.esc(HOME.projects[schedule.project].name)} · ${HOME.esc(host?.name || "")}</span><span class="schedule-next"><span class="schedule-label">${schedule.type}</span>${HOME.esc(next)}</span></span></button>`;
};
HOME.view.schedules = () => {
  const state = HOME.state;
  const items = state.schedules
    .filter((item) => !item.paused)
    .sort((a, b) => a.time.localeCompare(b.time));
  const groups = ["Hôm nay", "Ngày mai"]
    .map((day) => {
      const group = items.filter((s) => s.day === day);
      return group.length
        ? `<div class="schedule-group">${day.toUpperCase()}</div>${group.map(HOME.view.scheduleRow).join("")}`
        : "";
    })
    .join("");
  let body = HOME.view.empty(
    "clock",
    "Chưa có lịch sắp chạy",
    "Hẹn Clisbot làm một việc định kỳ, hoặc nhắc lại trong session đang có.",
    "new-schedule",
    "Tạo lịch đầu tiên",
  );
  if (items.length)
    body = `<div class="schedule-card">${groups}<div class="schedule-footer">${HOME.icon("clock")}Giờ của anh · Asia/Ho_Chi_Minh (UTC+7)</div></div>`;
  if (HOME.isLoading()) body = '<div class="skeleton"></div>';
  return `<section class="schedule-section"><div class="section-header"><div><h2>Sắp chạy tiếp theo</h2><div class="section-subtitle">Schedule & Heartbeat</div></div><button class="text-action" data-action="automations" aria-label="Xem tất cả lịch">${HOME.icon("right")}</button></div>${body}</section>`;
};
HOME.view.pulseStrip = () => {
  const sessions = HOME.state.sessions;
  const values = [
    ["running", "bolt", "Agent đang chạy", "Xem tiến độ"],
    ["attention", "bell", "Cần phản hồi", "Mở và xử lý"],
    ["schedule", "clock", "Lịch sắp tới", "Trong 24 giờ"],
  ];
  return `<div class="pulse-strip">${values
    .map(([key, icon, label, hint]) => {
      const count =
        key === "schedule"
          ? HOME.state.schedules.filter((s) => !s.paused).length
          : sessions.filter(
              (s) => s.status === key && HOME.state.hosts.find((h) => h.id === s.host)?.online,
            ).length;
      return `<button class="pulse-stat" data-action="${key === "schedule" ? "automations" : key}"><span class="stat-icon">${HOME.icon(icon)}</span><div><span class="stat-value">${count}</span><small><span class="stat-label">${label}</span><br />${hint}</small></div></button>`;
    })
    .join("")}</div>`;
};
HOME.view.footer = () =>
  `<div class="home-footer"><button data-action="connect">${HOME.icon("plus")}Thêm remote Host</button><button data-action="new-bot">Tạo Bot</button><button data-action="new-schedule">Tạo lịch</button><span class="footer-shortcut">⌘ K tìm kiếm · Enter gửi · Shift + Enter xuống dòng</span></div>`;
HOME.view.mobileNav = () =>
  `<nav class="mobile-nav" aria-label="Điều hướng mobile">${[
    ["home", "home", "Home"],
    ["history", "chat", "Sessions"],
    ["automations", "clock", "Lịch"],
    ["hosts", "host", "Hosts"],
  ]
    .map(
      ([action, icon, label]) =>
        `<button class="${action === "home" ? "active" : ""}" data-action="${action}">${HOME.icon(icon)}${label}</button>`,
    )
    .join("")}</nav>`;
HOME.view.shell = () =>
  `<div class="app-layout">${HOME.view.sidebar()}<main class="content">${HOME.view.topbar()}${HOME.view.hero()}${HOME.state.concept === "pulse" ? HOME.view.pulseStrip() : ""}<div class="lower-grid">${HOME.view.recent()}<aside class="aside-area">${HOME.view.attention()}${HOME.view.schedules()}</aside></div>${HOME.view.footer()}</main></div>${HOME.view.mobileNav()}`;
HOME.view.note = () => {
  const c = HOME.concepts[HOME.state.concept];
  return `<div><div class="note-id">CONCEPT ${c.number} / ${c.title.toUpperCase()}</div><h2>${c.accent}</h2></div><p>${c.description}</p><button data-action="design-detail">Xem chủ đích thiết kế ↗</button>`;
};
