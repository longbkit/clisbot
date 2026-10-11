HOME.view.chatDirection = () =>
  `<section class="hero chat-hero" aria-labelledby="home-title">${HOME.view.directionTitle()}${HOME.view.providerBar()}${HOME.view.notice()}${HOME.directionBase.onboarding()}<div class="chat-entry">${HOME.view.contextBand()}${HOME.view.composer()}</div>${HOME.view.quickStarts()}</section><div class="direction-lower chat-lower">${HOME.view.recent()}<aside class="aside-area">${HOME.view.attention()}${HOME.view.schedules()}</aside></div>`;
HOME.view.projectDirection = () =>
  `<section class="hero project-hero" aria-labelledby="home-title">${HOME.view.directionTitle()}${HOME.view.hostTiles()}${HOME.view.notice()}${HOME.directionBase.onboarding()}<div class="project-entry"><div class="project-composer">${HOME.view.contextBand()}${HOME.view.providerBar()}${HOME.view.composer()}</div>${HOME.view.workSummary()}</div>${HOME.view.quickStarts()}</section><div class="direction-lower project-lower">${HOME.view.recent()}<div class="project-bottom">${HOME.view.schedules()}${HOME.view.attention()}</div></div>`;
HOME.view.todayStats = () => {
  const counts = HOME.directionCounts();
  return `<div class="today-stats"><span class="today-date">${HOME.icon("clock")}Thứ Sáu, 09 tháng 10 <small>15:20 · giờ của anh</small></span>${[
    ["running", counts.running, "đang chạy"],
    ["attention", counts.attention, "cần phản hồi"],
    ["automations", counts.schedules, "lịch sắp tới"],
  ]
    .map(
      ([action, count, label]) =>
        `<button data-action="${action}"><strong>${count}</strong>${label}${HOME.icon("right")}</button>`,
    )
    .join("")}</div>`;
};
HOME.view.todayDirection = () =>
  `<section class="hero today-hero" aria-labelledby="home-title">${HOME.view.directionTitle()}${HOME.view.todayStats()}${HOME.view.notice()}${HOME.directionBase.onboarding()}<div class="today-entry">${HOME.view.contextBand()}${HOME.view.providerBar()}${HOME.view.composer()}</div>${HOME.view.quickStarts()}</section><div class="direction-lower today-lower"><aside class="today-attention">${HOME.view.attention()}</aside>${HOME.view.recent()}${HOME.view.schedules()}</div>`;
HOME.view.homeDirection = () =>
  `<section class="hero home-hero" aria-labelledby="home-title">${HOME.view.directionTitle()}${HOME.view.notice()}<div class="home-entry"><div class="home-chat"><div class="entry-heading"><span>${HOME.icon("chat")}Bắt đầu mới</span><span class="saved-draft">${HOME.state.draft ? "Bản nháp được giữ" : "Chat với Bot hoặc Agent session"}</span></div>${HOME.view.providerBar()}${HOME.view.composer()}${HOME.view.priority()}${HOME.view.quickStarts()}</div>${HOME.view.hostDock()}</div></section><div class="direction-lower home-lower">${HOME.view.recent()}<aside class="aside-area">${HOME.view.schedules()}${HOME.view.attention({ skipPriority: true })}</aside></div>`;
HOME.view.footer = () =>
  `<div class="home-footer"><button data-action="new-bot">${HOME.icon("plus")}Tạo Bot</button><button data-action="connect">${HOME.icon("remote")}Thêm remote Host</button><span class="footer-shortcut">⌘ K tìm kiếm · Enter gửi · Shift + Enter xuống dòng</span></div>`;
HOME.view.shell = () => {
  const layouts = {
    1: HOME.view.chatDirection,
    2: HOME.view.projectDirection,
    3: HOME.view.todayDirection,
    4: HOME.view.homeDirection,
  };
  return `<div class="app-layout">${HOME.view.sidebar()}<main class="content direction-${HOME.direction}">${HOME.view.topbar()}<div class="direction-canvas">${layouts[HOME.direction]()}${HOME.view.footer()}</div></main></div>${HOME.view.mobileNav()}`;
};
HOME.view.note = () => {
  const d = HOME.directions[HOME.direction];
  return `<div><div class="note-id">PHƯƠNG ÁN 0${HOME.direction} · ${d.tag}</div><h2>${d.name}</h2></div><p>${d.strength} Bản HTML tương tác, dùng dữ liệu và kết nối mô phỏng.</p><button data-action="direction-detail">Xem chủ đích thiết kế ↗</button>`;
};
