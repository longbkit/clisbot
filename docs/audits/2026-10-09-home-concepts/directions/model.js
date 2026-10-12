/* TARGET layouts. All data and effects stay in the existing local review fixture. */
HOME.direction = Number(document.body.dataset.direction);
HOME.directions = {
  1: {
    name: "Bắt đầu nhanh",
    tag: "CHAT FIRST",
    concept: "focus",
    headline: "Anh muốn bắt đầu từ đâu?",
    subtitle: "Một ý tưởng, một câu hỏi, hay một việc cần hoàn thành.",
    strength: "Ít lựa chọn trước tin nhắn đầu tiên; composer và gợi ý ở trung tâm.",
    tradeoff: "Cần mở thêm khi làm việc với nhiều Project hoặc theo dõi nhiều agent.",
  },
  2: {
    name: "Theo Project",
    tag: "PROJECT FIRST",
    concept: "workspace",
    headline: "Tiếp tục trong Project của anh.",
    subtitle: "Đúng máy tính, đúng thư mục. Mọi công việc giữ ngữ cảnh của mình.",
    strength: "Host và Project rõ; nhóm session theo cặp Host / Project, chuyển việc có chủ đích.",
    tradeoff: "Nhiều ngữ cảnh hơn trên màn hình; lần đầu cần hướng dẫn dễ hiểu.",
  },
  3: {
    name: "Nhịp công việc",
    tag: "TODAY FIRST",
    concept: "pulse",
    headline: "Công việc hôm nay, trong tầm mắt.",
    subtitle: "Bắt đầu một việc mới, phản hồi agent, rồi để lịch tiếp tục chạy.",
    strength: "Ưu tiên việc cần phản hồi, hoạt động đang chạy và lần chạy tiếp theo.",
    tradeoff: "Nhiều thông tin khi có nhiều hoạt động; cần composer luôn được ưu tiên.",
  },
  4: {
    name: "Home · Tổng hòa",
    tag: "RECOMMENDED",
    concept: "fusion",
    headline: "Anh muốn làm gì tiếp theo?",
    subtitle: "Bắt đầu từ một tin nhắn. Tiếp tục công việc khi anh cần.",
    strength:
      "Chat ở trung tâm, kết nối ngay bên cạnh, công việc bên dưới; mức chi tiết thay đổi theo trạng thái.",
    tradeoff: "Cần giữ ba vùng này nhất quán khi thêm tính năng mới.",
  },
};
HOME.state.activityScope = "all";
if (HOME.direction === 1) {
  try {
    if (!JSON.parse(sessionStorage.getItem("clisbot-home-direction-1") || "{}").launchpad)
      HOME.state.launchpad = ["write", "research", "cowork"];
  } catch {
    HOME.state.launchpad = ["write", "research", "cowork"];
  }
}
HOME.directionBase = {
  render: HOME.ui.render,
  onboarding: HOME.view.onboarding,
  filtered: HOME.view.filteredSessions,
  reset: HOME.ui.resetScenario,
};
HOME.directionSessions = () => {
  const sessions = HOME.directionBase.filtered();
  if (HOME.state.activityScope !== "project") return sessions;
  return sessions.filter(
    (s) => s.host === HOME.state.selectedHost && s.project === HOME.state.selectedProject,
  );
};
HOME.directionCounts = () => {
  const online = (s) => HOME.state.hosts.find((h) => h.id === s.host)?.online;
  return {
    running: HOME.state.sessions.filter((s) => s.status === "running" && online(s)).length,
    attention: HOME.state.sessions.filter((s) => s.status === "attention" && online(s)).length,
    schedules: HOME.state.schedules.filter((s) => !s.paused).length,
  };
};
HOME.directionOrigin = () => {
  if (HOME.isLoading()) return "Đang khôi phục lựa chọn gần nhất";
  if (HOME.state.webChecking) return "Đang kiểm tra local trên máy này";
  if (HOME.state.notice && !HOME.state.dismissed) return "Ngữ cảnh thay thế cho tin nhắn mới";
  if (HOME.isFirst() && HOME.selectedHost() && !HOME.selectedHost().local)
    return "Remote vừa được kết nối";
  if (HOME.state.scenario === "firstmobile") return "Mobile kết nối máy tính từ xa";
  if (HOME.isFirst() || HOME.state.scenario === "localstarting")
    return "Ưu tiên local trên Desktop / Web";
  return "Đã chọn theo lần dùng gần nhất";
};
HOME.directionHostInfo = () => {
  const host = HOME.selectedHost();
  const project = HOME.projects[HOME.state.selectedProject];
  const pending = HOME.pendingAssistant() && HOME.state.mode === "chat";
  const ready = HOME.canSend();
  let title = host?.name || "Kết nối máy tính";
  if (host?.local) title = "Local · Máy này";
  let status = "Chưa sẵn sàng";
  if (host?.online) status = "Online · cần hoàn tất thiết lập";
  if (ready) status = "Sẵn sàng bắt đầu";
  if (HOME.state.webChecking) status = "Đang tìm local…";
  let projectName = project?.name || "Chọn hoặc thêm Project";
  if (!project && pending) projectName = "Project riêng · tạo khi gửi";
  return {
    host,
    project,
    ready,
    title,
    status,
    projectName,
    subtitle: host?.local ? host.name : "Agent chạy trên Host này",
    origin: HOME.state.contextChanged ? "Anh đã chọn ngữ cảnh này" : HOME.directionOrigin(),
    detail: pending
      ? "Trợ lý cá nhân được tạo khi gửi tin đầu tiên."
      : "Tin nhắn mới dùng ngữ cảnh này.",
  };
};
