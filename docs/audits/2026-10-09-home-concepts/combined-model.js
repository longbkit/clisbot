/* TARGET only: combine the launchpad interaction with Clisbot's current owners. */
HOME.combined = {
  webTimer: null,
  baseLoad: HOME.loadScenario,
  baseBot: HOME.selectedBot,
  baseReady: HOME.canSend,
  baseSend: HOME.ui.send,
  baseReset: HOME.ui.resetScenario,
};
HOME.scenarios.firstdesktop = [
  "Lần đầu · Desktop / local sẵn sàng",
  "Host local được chọn tự động. Gửi tin đầu tiên để tạo trợ lý cá nhân.",
];
HOME.scenarios.firstweb = [
  "Lần đầu · Web / kiểm tra local",
  "Tự kiểm tra local, rồi chọn khi kết nối được.",
];
HOME.scenarios.firstwebmissing = [
  "Lần đầu · Web / chưa chạy local",
  "Hướng dẫn mở Desktop hoặc chạy Host, tìm lại, hay kết nối remote.",
];
HOME.scenarios.firstwebblocked = [
  "Lần đầu · Web / trình duyệt chặn local",
  "Hướng dẫn quyền mạng local hoặc ghép nối qua transport phù hợp.",
];
HOME.scenarios.localstarting = [
  "Desktop / local đang khởi động",
  "Chờ Host do Desktop quản lý; giữ draft, có lựa chọn remote.",
];
HOME.scenarios.firstnoprovider = [
  "Lần đầu · Local thiếu provider",
  "Local đã online, chỉ thiếu một provider để gửi.",
];
HOME.scenarios.pairingerror = [
  "Mobile / ghép nối không thành công",
  "Phân biệt QR hết hạn và lỗi mạng; giữ dữ liệu để thử lại.",
];
Object.assign(HOME.state, {
  launchpad: ["cowork", "write", "research", "review"],
  category: "",
  focusedStarter: "",
  model: "Mặc định của Host",
  permission: "Default permissions",
  webChecking: false,
  webFound: false,
  localBootDone: false,
  pairingIssue: "",
  selectedBotName: null,
});
HOME.starters = {
  cowork: {
    title: "Cowork",
    subtitle: "Làm việc trong Project",
    icon: "bolt",
    category: "plan",
    mode: "agent",
    prompt:
      "Giúp tôi hoàn thành công việc trong Project này. Trước tiên làm rõ mục tiêu, rồi đề xuất các bước thực hiện.",
    detail:
      "Làm việc với agent trong Project: đọc tệp, lên kế hoạch, sửa code hoặc xử lý tài liệu. Host, Workspace và quyền luôn được kiểm tra trước khi gửi.",
  },
  write: {
    title: "Viết nội dung",
    subtitle: "Email, tài liệu, bài viết",
    icon: "edit",
    category: "write",
    mode: "chat",
    prompt:
      "Giúp tôi viết một nội dung rõ ràng, phù hợp với người đọc. Hãy hỏi tôi về mục tiêu, đối tượng và giọng văn.",
    detail: "Bắt đầu bằng một bản nháp. Bot sẽ giúp chỉnh cấu trúc, giọng văn và nội dung.",
  },
  research: {
    title: "Nghiên cứu",
    subtitle: "Tìm hiểu và so sánh",
    icon: "search",
    category: "research",
    mode: "chat",
    prompt:
      "Giúp tôi nghiên cứu chủ đề sau, so sánh các lựa chọn và ghi rõ nguồn cho những kết luận quan trọng.",
    detail: "Làm rõ câu hỏi, phạm vi và tiêu chí trước khi tìm hiểu.",
  },
  review: {
    title: "Review code",
    subtitle: "Thay đổi trong Project",
    icon: "terminal",
    category: "code",
    mode: "agent",
    prompt:
      "Review các thay đổi trong Project. Ưu tiên lỗi, rủi ro hồi quy và các kiểm tra cần thiết; ghi rõ tệp và vị trí.",
    detail: "Mở Agent session mới trong Project đã chọn. Không đổi Host của session đang có.",
  },
  plan: {
    title: "Lên kế hoạch",
    subtitle: "Từ ý tưởng đến các bước",
    icon: "project",
    category: "plan",
    mode: "chat",
    prompt:
      "Giúp tôi chia mục tiêu này thành các bước thực hiện, xác định phụ thuộc và việc nên bắt đầu trước.",
    detail: "Giữ kế hoạch trong cuộc trò chuyện để mình tiếp tục và cập nhật.",
  },
  numbers: {
    title: "Phân tích số liệu",
    subtitle: "Dữ liệu và quyết định",
    icon: "chart",
    category: "research",
    mode: "chat",
    prompt:
      "Giúp tôi phân tích dữ liệu tôi cung cấp, làm rõ giả định và đề xuất cách trình bày các kết quả chính.",
    detail: "Đính kèm dữ liệu hoặc chọn Project chứa tài liệu cần phân tích.",
  },
  schedule: {
    title: "Tạo lịch",
    subtitle: "Làm việc định kỳ",
    icon: "clock",
    category: "automation",
    mode: "chat",
    prompt:
      "Giúp tôi lên nội dung cho một lịch làm việc định kỳ, xác định giờ chạy, Host, Project và nơi nhận kết quả.",
    detail:
      "Dùng Schedule cho session mới mỗi lần, hoặc Heartbeat cho session đang có. Mở form lịch để xác nhận trước khi tạo.",
  },
  summary: {
    title: "Tổng hợp công việc",
    subtitle: "Những việc đang mở",
    icon: "chat",
    category: "plan",
    mode: "chat",
    prompt: "Tổng hợp những việc đang mở trong Project và đề xuất ba ưu tiên tiếp theo.",
    detail: "Bắt đầu từ ngữ cảnh Project đã chọn.",
  },
};
HOME.categories = [
  ["write", "Viết", "edit"],
  ["research", "Nghiên cứu", "search"],
  ["plan", "Lên kế hoạch", "project"],
  ["code", "Code", "terminal"],
  ["automation", "Tự động hóa", "clock"],
];
HOME.icons.edit = '<path d="m15 4 5 5M4 20l4-1L21 6a2 2 0 0 0-3-3L5 16Z"/>';
HOME.icons.chart = '<path d="M4 3v17h17M8 15v-5m5 5V6m5 9v-3"/>';
HOME.icons.layout = '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16"/>';
HOME.icons.grid =
  '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>';
HOME.icons.left = '<path d="m15 5-7 7 7 7"/>';
HOME.icons.more =
  '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>';
HOME.state.lastProjects = {};
HOME.resolveContext = (previousHost, previousProject) => {
  const state = HOME.state;
  const eligible = state.hosts.filter((host) => host.online);
  const host =
    eligible.find((item) => item.id === previousHost) ||
    eligible.find((item) => item.local && item.ready) ||
    eligible.find((item) => item.ready) ||
    eligible[0];
  state.selectedHost = host?.id || null;
  const projects = HOME.availableProjects(host);
  const remembered = state.lastProjects[host?.id];
  state.selectedProject = projects.includes(remembered) ? remembered : projects[0] || null;
  if (projects.includes(previousProject) && host?.id === previousHost)
    state.selectedProject = previousProject;
  state.provider = host?.providers.includes(state.provider)
    ? state.provider
    : host?.providers[0] || "Claude Code";
  HOME.contextNotice(previousHost, previousProject);
};
HOME.providerIcon = (provider) => HOME.providerSvg?.[provider] || HOME.icon("terminal");
HOME.botKey = (bot) => `${bot.host}:${bot.project}:${bot.name}`;
HOME.pendingAssistant = () =>
  !!(
    (HOME.isFirst() || HOME.state.scenario === "localstarting") &&
    HOME.selectedHost()?.local &&
    !HOME.availableProjects(HOME.selectedHost()).length
  );
HOME.selectedBot = () => {
  if (HOME.pendingAssistant() && HOME.state.mode === "chat")
    return {
      name: "Trợ lý cá nhân",
      avatar: "PA",
      provider: HOME.state.provider,
      project: null,
      host: "local",
      pending: true,
    };
  const explicit = HOME.bots.find(
    (bot) =>
      bot.name === HOME.state.selectedBotName &&
      bot.host === HOME.state.selectedHost &&
      bot.project === HOME.state.selectedProject,
  );
  return explicit || HOME.combined.baseBot();
};
HOME.canSend = () => {
  if (
    HOME.state.webChecking ||
    (HOME.state.scenario === "localstarting" && !HOME.state.localBootDone)
  )
    return false;
  if (HOME.pendingAssistant() && HOME.state.mode === "chat")
    return !!(HOME.selectedHost()?.online && HOME.selectedHost()?.ready && !HOME.isLoading());
  return HOME.combined.baseReady();
};
HOME.prepareLocal = (ready = true) => {
  HOME.state.hosts = [{ ...structuredClone(HOME.hosts[0]), projects: [], ready }];
  HOME.state.selectedHost = "local";
  HOME.state.selectedProject = null;
  HOME.state.provider = "Claude Code";
  HOME.state.notice = null;
};
HOME.loadScenario = () => {
  clearTimeout(HOME.combined.webTimer);
  HOME.combined.baseLoad();
  const state = HOME.state;
  state.webChecking = false;
  state.pairingIssue = "";
  if (
    !state.connected &&
    (state.scenario === "firstdesktop" || state.scenario === "firstnoprovider")
  )
    HOME.prepareLocal(state.scenario !== "firstnoprovider" || state.providerReady);
  if (state.scenario === "firstweb" && !state.connected) HOME.startWebCheck();
  if (
    !state.connected &&
    ["firstwebmissing", "firstwebblocked", "pairingerror"].includes(state.scenario)
  )
    state.hosts = [];
  if (state.scenario === "localstarting" && !state.localBootDone && !state.connected) {
    HOME.prepareLocal();
    state.hosts[0].online = false;
    state.sessions = [];
    state.schedules = [];
  }
  if (state.scenario === "firstweb" && state.webFound && !state.connected) {
    HOME.prepareLocal();
    state.webChecking = false;
  }
  if (!state.hosts.length) {
    state.selectedHost = null;
    state.selectedProject = null;
  }
  if (["fallback", "projectmissing"].includes(state.scenario))
    HOME.contextNotice("local", "clisbot");
};
HOME.startWebCheck = () => {
  if (HOME.state.webFound) return;
  HOME.state.hosts = [];
  HOME.state.selectedHost = null;
  HOME.state.selectedProject = null;
  HOME.state.webChecking = true;
  HOME.combined.webTimer = setTimeout(() => {
    if (HOME.state.scenario !== "firstweb" || HOME.state.connected) return;
    HOME.state.webFound = true;
    HOME.state.webChecking = false;
    HOME.prepareLocal();
    HOME.ui.render();
  }, 1300);
};
HOME.ui.resetScenario = (id) => {
  HOME.state.webFound = false;
  HOME.state.localBootDone = false;
  HOME.state.focusedStarter = "";
  HOME.state.category = "";
  HOME.state.selectedBotName = null;
  clearTimeout(HOME.ui.toastTimer);
  document.querySelector("#toast").classList.remove("visible");
  HOME.combined.baseReset(id);
  if (id === "pairingerror") {
    HOME.state.viewport = "mobile";
    HOME.state.pairingIssue = "expired";
    HOME.ui.render();
  }
};
HOME.ui.send = () => {
  if (!HOME.canSend() || !HOME.state.draft.trim()) return;
  if (HOME.pendingAssistant()) {
    const id = "personal-assistant";
    HOME.projects[id] = {
      name: "Trợ lý cá nhân",
      path: "Project riêng của Bot",
      color: "ocean",
      letter: "PA",
    };
    HOME.selectedHost().projects.push(id);
    HOME.state.selectedProject = id;
    HOME.bots.push({
      name: "Trợ lý cá nhân",
      host: "local",
      project: id,
      provider: HOME.state.provider,
      avatar: "PA",
    });
    HOME.state.selectedBotName = "Trợ lý cá nhân";
  }
  HOME.combined.baseSend();
  HOME.state.lastUsed.provider = HOME.state.provider;
  HOME.state.lastUsed.bot = HOME.state.selectedBotName;
  HOME.state.lastProjects[HOME.state.selectedHost] = HOME.state.selectedProject;
  HOME.ui.save();
};
HOME.ui.actions.send = HOME.ui.send;
HOME.ui.actions.reset = () => HOME.ui.resetScenario(HOME.state.scenario);
