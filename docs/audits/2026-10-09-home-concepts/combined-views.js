/* Combined proposal: current Clisbot chrome, an explicit connection, then chat. */
HOME.view.sidebar = () => {
  const state = HOME.state;
  const projects = [...new Set(state.hosts.flatMap((host) => host.projects))];
  const bots = HOME.bots.filter((bot) =>
    state.hosts.some((host) => host.projects.includes(bot.project) && host.id === bot.host),
  );
  const botRows = bots
    .slice(0, 3)
    .map(
      (bot) =>
        `<button class="side-project" data-action="choose-bot" data-id="${HOME.esc(HOME.botKey(bot))}"><span class="avatar">${HOME.esc(bot.avatar)}</span><span>${HOME.esc(bot.name)}${bot.host !== "local" ? `<small class="side-bot-host">Dev server</small>` : ""}</span></button>`,
    )
    .join("");
  const rows = projects
    .map(
      (id) =>
        `<button class="side-project ${state.selectedProject === id ? "selected" : ""}" data-action="side-project" data-id="${id}">${HOME.icon("project")}<span>${HOME.esc(HOME.projects[id].name)}</span>${HOME.icon("down")}</button>${state.sessions
          .filter((s) => s.project === id)
          .slice(0, 2)
          .map(
            (s) =>
              `<button class="side-session" data-action="session" data-id="${s.id}">${HOME.icon(s.type === "chat" ? "chat" : "terminal")}<span>${HOME.esc(s.title)}</span></button>`,
          )
          .join("")}`,
    )
    .join("");
  return `<aside class="sidebar"><div class="brand"><span class="logo">${HOME.logo}</span><span class="brand-name">Clisbot</span><button class="icon-button" data-action="account" aria-label="Tài khoản">${HOME.icon("down")}</button></div><nav aria-label="Điều hướng">${HOME.view.nav("new-workspace", "plus", "New workspace")}${HOME.view.nav("history", "clock", "History")}${HOME.view.nav("automations", "bolt", "Automations")}${HOME.view.nav("connectors", "link", "Connectors")}</nav><div class="side-heading">Bots<button data-action="new-bot" aria-label="Tạo Bot">${HOME.icon("plus")}</button></div>${botRows || '<div class="side-empty">Bot đầu tiên sẽ xuất hiện ở đây.</div>'}<div class="side-heading">Projects<button data-action="add-project" aria-label="Thêm Project">${HOME.icon("plus")}</button></div><div class="side-segments"><button class="active" data-action="projects">Project</button><button data-action="history">Session</button><button data-action="sidebar-more">More</button></div><div class="side-filter">Active ${HOME.icon("down")}</div>${rows || '<div class="side-empty">Thêm Project để làm việc với code và tệp.</div>'}<div class="side-footer"><button class="side-new" data-action="new-menu">${HOME.icon("plus")}New</button><button class="side-search" data-action="search">${HOME.icon("search")}Search <kbd>⌘ K</kbd></button><div class="side-footer-icons"><button class="icon-button" data-action="usage" aria-label="Usage">${HOME.icon("chart")}</button><button class="icon-button" data-action="hosts" aria-label="Hosts">${HOME.icon("host")}</button><button class="icon-button" data-action="help" aria-label="Trợ giúp">${HOME.icon("help")}</button><button class="icon-button" data-action="settings" aria-label="Cài đặt">${HOME.icon("settings")}</button></div></div></aside>`;
};
HOME.view.topbar = () =>
  `<header class="topbar"><div class="breadcrumb"><button class="icon-button" data-action="mobile-menu" aria-label="Mở điều hướng">${HOME.icon("layout")}</button><strong>Home</strong></div><div class="top-actions"><button class="icon-button" data-action="search" aria-label="Tìm kiếm">${HOME.icon("search")}</button><button class="icon-button" data-action="attention" aria-label="Việc cần chú ý">${HOME.icon("bell")}</button><button class="icon-button" data-action="sidebar-more" aria-label="Tùy chọn">${HOME.icon("more")}</button></div></header>`;
HOME.view.providerBar = () => {
  const state = HOME.state;
  const bot = HOME.selectedBot();
  const providers = HOME.selectedHost()?.providers || ["Claude Code", "Codex", "OpenCode"];
  return `<div class="provider-strip" role="group" aria-label="Bot hoặc provider để bắt đầu"><button class="bot-switch ${state.mode === "chat" ? "active" : ""}" data-action="mode-chat"><span class="provider-symbol">${HOME.icon("chat")}</span><span>${HOME.esc(bot?.name || "Chat với Bot")}</span>${HOME.icon("down")}</button><span class="strip-divider"></span>${providers
    .slice(0, 3)
    .map(
      (provider) =>
        `<button class="provider-switch ${state.mode === "agent" && state.provider === provider ? "active" : ""}" data-action="choose-provider" data-id="${provider}" title="${provider} · Agent session mới" aria-label="${provider} · Agent session mới" aria-pressed="${state.mode === "agent" && state.provider === provider}"><span class="provider-symbol">${HOME.providerIcon(provider)}</span><span class="provider-name">${provider}</span></button>`,
    )
    .join(
      "",
    )}<button class="provider-more" data-action="providers" aria-label="Các provider khác">${HOME.icon("plus")}</button></div>`;
};
HOME.view.contextBand = () => {
  const host = HOME.selectedHost() || { name: "Chưa kết nối Host", online: false, local: false };
  const project = HOME.projects[HOME.state.selectedProject];
  const pending = HOME.pendingAssistant() && HOME.state.mode === "chat";
  const loading = HOME.isLoading() || HOME.state.webChecking;
  let label = host.name;
  if (host.local) label = "Local · Máy này";
  if (loading) label = "Đang tìm Host…";
  let connection = HOME.state.selectedHost ? "Offline" : "Chưa kết nối";
  if (loading) connection = "Đang kiểm tra";
  if (host.online) connection = "Online";
  const projectLabel = project?.name || (pending ? "Project riêng · Tạo khi gửi" : "Chọn Project");
  return `<div class="host-context"><button class="host-context-choice" data-action="hosts" ${loading ? "disabled" : ""}>${HOME.icon(host.local ? "host" : "remote")}<span><small>Host</small><strong>${HOME.esc(label)}</strong></span><span class="connection-status"><span class="dot ${host.online ? "online" : ""}"></span>${connection}</span>${HOME.icon("down")}</button><span class="context-divider"></span><button class="project-context-choice" data-action="projects" ${loading ? "disabled" : ""}>${HOME.icon("project")}<span><small>Project</small><strong>${HOME.esc(projectLabel)}</strong></span>${HOME.icon("down")}</button><button class="remote-add" data-action="connect">${HOME.icon("plus")}<span>Remote Host</span></button></div>`;
};
HOME.view.onboarding = () => {
  const state = HOME.state;
  const host = HOME.selectedHost();
  const button = (action, label, primary = false) =>
    `<button class="${primary ? "primary-button" : "outline-button"}" data-action="${action}">${label}</button>`;
  const remote = button("connect", "Kết nối remote Host");
  const card = (icon, title, copy, actions = "", cls = "") =>
    `<section class="connection-card ${cls}" role="status"><span class="connection-icon">${HOME.icon(icon)}</span><div><h2>${title}</h2><p>${copy}</p>${actions ? `<div class="connection-actions">${actions}</div>` : ""}</div></section>`;
  if (HOME.isLoading())
    return card(
      "clock",
      "Đang khôi phục ngữ cảnh gần nhất",
      "Giữ bản nháp trong lúc tải Host và Project.",
      button("finish-loading", "Mô phỏng tải xong"),
    );
  if (state.webChecking)
    return card(
      "clock",
      "Đang kiểm tra Host local trên máy này",
      "Khi kết nối được, Clisbot chọn local để anh có thể bắt đầu ngay.",
      remote,
      "checking",
    );
  if (state.scenario === "localstarting" && !state.localBootDone && !state.connected)
    return card(
      "clock",
      "Đang khởi động Host local",
      "Clisbot Desktop đang chuẩn bị Host trên máy này. Bản nháp vẫn được giữ.",
      button("local-started", "Mô phỏng khởi động xong") + remote,
      "checking",
    );
  if (state.scenario === "firstwebmissing" && !state.connected)
    return card(
      "host",
      "Bắt đầu với Host local trên máy này",
      "Mở Clisbot Desktop, hoặc chạy clisbot daemon start trong terminal. Sau đó thử tìm lại local.",
      button("local-help", "Hướng dẫn local") +
        button("retry-local", "Tìm lại local", true) +
        remote,
    );
  if (state.scenario === "firstwebblocked" && !state.connected)
    return card(
      "shield",
      "Trình duyệt chưa truy cập được Host local",
      "Cho phép kết nối mạng local nếu trình duyệt yêu cầu, rồi tìm lại. Anh cũng có thể dùng liên kết ghép nối.",
      button("local-help", "Xem hướng dẫn") + button("retry-local", "Thử lại") + remote,
    );
  if ((state.scenario === "firstmobile" || state.scenario === "pairingerror") && !state.connected)
    return card(
      "phone",
      "Kết nối máy tính của anh",
      "Agent chạy trên máy tính. Mở Clisbot Desktop → Hosts → Pair device, rồi quét QR hoặc dán liên kết trên điện thoại.",
      button("connect", "Kết nối remote Host", true),
      "mobile-onboarding",
    );
  if (!host?.online)
    return card(
      "link",
      "Cần một Host online để bắt đầu",
      "Kiểm tra kết nối máy tính. Session và lịch đã có vẫn giữ Host gốc.",
      button("reconnect", "Kết nối lại") + remote,
    );
  if (!host.ready)
    return card(
      "terminal",
      "Local đã online. Chuẩn bị một provider.",
      "Cài hoặc đăng nhập Claude Code, Codex hay provider anh dùng trên Host này.",
      button("provider-setup", "Chuẩn bị provider", true) + remote,
    );
  if (HOME.pendingAssistant() && state.mode === "chat")
    return card(
      "check",
      "Local đã sẵn sàng. Cứ nhắn điều anh cần.",
      "Trợ lý cá nhân và Project riêng sẽ được tạo khi gửi tin đầu tiên. Dùng model và quyền mặc định, có thể kiểm tra bên dưới.",
      "",
      "local-ready",
    );
  if (!state.selectedProject)
    return card(
      "project",
      "Chọn Project để bắt đầu Agent session",
      "Thêm thư mục làm việc trên Host local hoặc chọn Project trên remote Host.",
      button("add-project", "Thêm Project", true) + remote,
    );
  return "";
};
HOME.view.contextCopy = () => {
  const host = HOME.selectedHost();
  if (HOME.state.webChecking || HOME.isLoading()) return "Đang xác định Host · bản nháp được giữ";
  if (!host?.online) return "Kết nối Host để gửi · bản nháp được giữ";
  if (!host.ready) return "Provider chưa sẵn sàng · cài hoặc đăng nhập trên Host";
  if (HOME.pendingAssistant() && HOME.state.mode === "chat")
    return "Trợ lý cá nhân · tạo khi gửi · Project riêng · Default permissions";
  if (!HOME.state.selectedProject) return "Chọn Project trước khi bắt đầu Agent session";
  if (HOME.state.mode === "chat")
    return `Chat mới · ${HOME.esc(HOME.selectedBot()?.name || "Chọn Bot")} · cấu hình của Bot`;
  return `Agent session mới · Workspace mặc định · ${HOME.esc(HOME.state.provider)}`;
};
HOME.view.composer = () => {
  const state = HOME.state;
  const bot = HOME.selectedBot();
  const provider = state.mode === "chat" ? bot?.provider : state.provider;
  const files = state.files
    .map(
      (file, i) =>
        `<span class="file-chip">${HOME.icon("attach")}${HOME.esc(file)}<button data-action="remove-file" data-id="${i}" aria-label="Bỏ tệp ${HOME.esc(file)}">${HOME.icon("close")}</button></span>`,
    )
    .join("");
  const chip = (action, icon, label) =>
    `<button class="compose-option" data-action="${action}">${HOME.icon(icon)}<span>${HOME.esc(label)}</span>${HOME.icon("down")}</button>`;
  return `<div class="composer"><textarea id="prompt" aria-label="Tin nhắn mới" placeholder="${state.mode === "chat" ? "Nhắn điều anh cần, đính kèm tài liệu hoặc bắt đầu một ý tưởng…" : "Mô tả việc cần agent thực hiện trong Project…"}">${HOME.esc(state.draft)}</textarea><div class="file-chips">${files}</div><div class="composer-bottom"><div class="compose-options"><button class="icon-button" data-action="compose-menu" aria-label="Thêm vào tin nhắn">${HOME.icon("plus")}</button>${chip("model", "terminal", provider ? provider + " · Default model" : "Model mặc định")}${chip("permission", "shield", state.permission)}<button class="compose-option thinking-option" data-action="thinking">Thinking ${HOME.icon("down")}</button></div><div class="send-area"><button class="icon-button" data-action="voice" aria-label="Nhập bằng giọng nói">${HOME.icon("mic")}</button><button id="send" class="send-button" data-action="send" aria-label="Gửi và bắt đầu ${state.mode === "chat" ? "Chat" : "Agent session"}" ${!HOME.canSend() || !state.draft.trim() ? "disabled" : ""}>${HOME.icon("arrow")}</button></div></div></div><div class="composer-context">${HOME.icon(HOME.canSend() ? "check" : "info")}<span>${HOME.view.contextCopy()}</span><button data-action="context">Chi tiết ${HOME.icon("down")}</button></div>`;
};
HOME.view.launchpad = () => {
  const state = HOME.state;
  const cards = state.launchpad
    .map((id) => {
      const s = HOME.starters[id];
      return `<div class="starter-wrap"><button class="starter-card ${state.focusedStarter === id ? "selected" : ""}" data-action="starter" data-id="${id}"><span class="starter-icon ${id}">${HOME.icon(s.icon)}</span><strong>${s.title}</strong><span>${s.subtitle}</span></button><button class="starter-remove" data-action="unpin-starter" data-id="${id}" aria-label="Bỏ ghim ${s.title}">${HOME.icon("close")}</button></div>`;
    })
    .join("");
  const categories = HOME.categories
    .map(
      ([id, label, icon]) =>
        `<button class="${state.category === id ? "active" : ""}" data-action="category" data-id="${id}" aria-pressed="${state.category === id}">${HOME.icon(icon)}${label}</button>`,
    )
    .join("");
  const category = HOME.categories.find(([id]) => id === state.category);
  const expanded = category
    ? `<div class="category-panel"><div class="category-heading"><strong>Bắt đầu với ${category[1].toLowerCase()}</strong><button class="icon-button" data-action="category" data-id="${category[0]}" aria-label="Đóng gợi ý">${HOME.icon("close")}</button></div>${Object.entries(
        HOME.starters,
      )
        .filter(([, s]) => s.category === state.category)
        .map(
          ([id, s]) =>
            `<button class="prompt-starter" data-action="starter" data-id="${id}"><strong>${s.title} ${HOME.icon("right")}</strong><span>${s.prompt}</span></button>`,
        )
        .join("")}</div>`
    : "";
  return `<section class="launchpad" aria-label="Gợi ý bắt đầu"><div class="launchpad-heading"><span>Gợi ý bắt đầu</span><button class="text-action" data-action="launchpad">Tùy chỉnh ${HOME.icon("more")}</button></div><div class="starter-grid">${cards}<button class="starter-add" data-action="launchpad">${HOME.icon("plus")}<span>Thêm</span></button></div><div class="category-tabs" role="group" aria-label="Loại công việc">${categories}</div>${expanded}</section>`;
};
HOME.view.hero = () => {
  const starter = HOME.starters[HOME.state.focusedStarter];
  const focused = starter && HOME.state.focusedStarter === "cowork";
  const greeting = HOME.isFirst() ? "Chào anh, bắt đầu cùng Clisbot." : "Hôm nay anh muốn làm gì?";
  const title = focused
    ? `<div class="starter-focus-heading"><button class="icon-button" data-action="exit-starter" aria-label="Trở về Home">${HOME.icon("left")}</button><span class="starter-icon cowork">${HOME.icon("bolt")}</span><h1 id="home-title">Cowork</h1></div><p class="starter-description">${starter.detail}</p>`
    : `<div class="hero-title-row"><h1 id="home-title">${greeting}</h1><p class="hero-subtitle">Bắt đầu mới hoặc tiếp tục công việc gần đây.</p></div>`;
  return `<section class="hero" aria-labelledby="home-title">${HOME.view.providerBar()}${title}${HOME.view.notice()}${HOME.view.onboarding()}${HOME.view.contextBand()}${HOME.view.composer()}${HOME.view.launchpad()}</section>`;
};
HOME.view.footer = () =>
  `<div class="home-footer"><button data-action="new-bot">${HOME.icon("plus")}Tạo Bot</button><button data-action="new-schedule">${HOME.icon("clock")}Tạo lịch</button><span class="footer-shortcut">⌘ K tìm kiếm · Enter gửi · Shift + Enter xuống dòng</span></div>`;
const combinedAttention = HOME.view.attention;
HOME.view.attention = () => {
  if (
    !HOME.state.sessions.length &&
    (HOME.isFirst() || ["pairingerror", "localstarting"].includes(HOME.state.scenario))
  )
    return "";
  return combinedAttention();
};
HOME.view.note = () =>
  `<div><div class="note-id">COMBINED / PRODUCT UI</div><h2>Chat ở phía trước. Host rõ ràng. Bắt đầu từ local.</h2></div><p>Thanh provider và launchpad từ concept mẫu; nền, font, khoảng cách và sidebar theo Clisbot. Bản HTML tương tác dùng dữ liệu mẫu, mọi kết nối và lần gửi đều được mô phỏng.</p><button data-action="host-guide">Xem đầy đủ luồng Host ↗</button>`;
