/* Fictional, browser-only data. This prototype never connects to a Host. */
const HOME = {};
HOME.icons = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  chat: '<path d="M21 11a8 8 0 0 1-8 8H8l-5 3V11a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z"/><path d="M8 9h8M8 13h5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  project:
    '<path d="M3 8V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  host: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  remote:
    '<rect x="4" y="3" width="16" height="7" rx="2"/><rect x="4" y="14" width="16" height="7" rx="2"/><path d="M8 6.5h.01M8 17.5h.01m4-11h4m-4 11h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  settings:
    '<path d="m9 3-1 3-3 1-2 4 2 2v3l4 3 3-1 3 1 4-3v-3l2-2-2-4-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0v7l2 3H4l2-3Zm4 13h4"/>',
  shield: '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z"/><path d="m8 12 3 3 5-6"/>',
  attach: '<path d="m8 12 7-7a4 4 0 0 1 6 6L10 22a6 6 0 0 1-8-8L13 3m-7 13 9-9"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  moon: '<path d="M20 15a9 9 0 0 1-11-11 9 9 0 1 0 11 11Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 1c0 2-3 2-3 5m0 3h.01"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  branch:
    '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10m0-5h5a7 7 0 0 0 7-4"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  link: '<path d="m10 13 4-4m-6 6-2 2a4 4 0 0 0 6 6l4-4m-6-10 4-4a4 4 0 0 1 6 6l-2 2"/>',
};
HOME.icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${HOME.icons[name] || HOME.icons.chat}</svg>`;
HOME.logo =
  '<svg viewBox="0 0 360 300" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M44 0H246C266 0 280 15 280 35V100H204C174 100 155 122 155 150V172C155 196 145 207 124 207H45C19 207 0 188 0 163V45C0 19 19 0 44 0ZM54 31C44.06 31 36 39.06 36 49C36 58.94 44.06 67 54 67H208C217.94 67 226 58.94 226 49C226 39.06 217.94 31 208 31H54Z"/><path d="M220 135H322C344 135 360 152 360 174V223C360 246 346 263 324 263V289C324 296 320 299 314 294L279 265H205C183 265 166 255 160 240C177 233 188 221 188 203V172C188 150 200 135 220 135Z"/></svg>';
HOME.esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
HOME.concepts = {
  focus: {
    number: "01",
    title: "Focus",
    tag: "MỘT Ý TƯỞNG. MỘT ĐIỂM BẮT ĐẦU.",
    headline: "Mình bắt đầu với điều gì?",
    subtitle: "Một câu hỏi, một ý tưởng, hay việc anh muốn hoàn thành.",
    accent: "Ít lựa chọn, bắt đầu nhanh",
    description:
      "Chat chiếm sân khấu. Host và Project luôn ở ngay trong composer. Lịch sắp tới thu gọn, công việc gần đây thành những thẻ dễ tiếp tục.",
    strengths: [
      "Composer lớn, ít nhiễu",
      "Ngữ cảnh được chọn sẵn",
      "Gợi ý để vượt qua trang trắng",
    ],
    tradeoff: "Khi quản lý nhiều Project, cần mở bộ chọn thường xuyên hơn.",
    audience: "Người dùng cá nhân, chat nhiều, bắt đầu việc mới thường xuyên.",
  },
  workspace: {
    number: "02",
    title: "Workspace",
    tag: "NGỮ CẢNH RÕ. CÔNG VIỆC LIỀN MẠCH.",
    headline: "Tiếp tục từ nơi anh dừng lại.",
    subtitle: "Project đã sẵn sàng. Bắt đầu bằng một tin nhắn.",
    accent: "Có tổ chức, dễ tiếp tục",
    description:
      "Điều hướng Project cố định bên trái, chat ở phía trước và session nhóm theo Project phía dưới. Lịch và việc cần chú ý nằm cạnh luồng công việc.",
    strengths: [
      "Host, Project, Workspace rõ ràng",
      "Session nhóm theo Project",
      "Điều hướng và pin luôn sẵn",
    ],
    tradeoff: "Nhiều cấu trúc hơn; cần thu gọn sidebar trên màn hình nhỏ.",
    audience: "Người làm việc nhiều Project, thường mở lại Agent session.",
  },
  pulse: {
    number: "03",
    title: "Pulse",
    tag: "NHỊP CÔNG VIỆC, TRONG TẦM TAY.",
    headline: "Hôm nay, mình làm gì tiếp?",
    subtitle: "Nhắn một câu để bắt đầu. Mọi việc đang chạy ở ngay bên dưới.",
    accent: "Nắm tình hình, xử lý đúng lúc",
    description:
      "Composer mở màn; bên dưới là nhịp hoạt động theo thời gian. Session, lịch sắp chạy và việc cần anh xử lý có thứ tự đọc rõ ràng.",
    strengths: [
      "Ưu tiên việc cần phản hồi",
      "Nhịp thời gian trực quan",
      "Lịch và trạng thái ở cùng một nơi",
    ],
    tradeoff: "Mật độ thông tin tăng nếu có nhiều hoạt động; cần giới hạn số mục.",
    audience: "Người chạy nhiều agent, theo dõi automation và làm việc từ mobile.",
  },
  fusion: {
    number: "04",
    title: "Tổng hợp",
    tag: "MỌI VIỆC BẮT ĐẦU TỪ MỘT CUỘC TRÒ CHUYỆN.",
    headline: "Chào Long, mình làm gì tiếp?",
    subtitle: "Nói điều anh cần. Clisbot đã chuẩn bị ngữ cảnh cho anh.",
    accent: "Chat trước. Ngữ cảnh rõ. Công việc trong tầm mắt.",
    description:
      "Composer của Focus, điều hướng và ngữ cảnh của Workspace, phần cần chú ý và lịch của Pulse. Home ưu tiên hành động đầu tiên, rồi cho anh tiếp tục đúng việc.",
    strengths: [
      "Focus → chat chính diện",
      "Workspace → đúng Host & Project",
      "Pulse → ưu tiên và lịch sắp tới",
    ],
    tradeoff: "Cần giữ nguyên tắc: ít mục mặc định, mở thêm khi cần, một CTA chính.",
    audience: "Một Home chung cho desktop, web và mobile.",
  },
};
HOME.scenarios = {
  returning: ["Đã dùng trước đó", "Khôi phục Host và Project của lần gửi gần nhất."],
  fallback: [
    "Host gần nhất offline",
    "Đề xuất Host online; báo rõ thay đổi cho cuộc trò chuyện mới.",
  ],
  projectmissing: [
    "Project gần nhất không còn",
    "Project cũ đã bị xóa; chọn Project khả dụng trên cùng Host.",
  ],
  firstdesktop: ["Lần đầu · Desktop", "Ưu tiên Host local do desktop quản lý; có lối thêm remote."],
  firstweb: ["Lần đầu · Web", "Tìm Host local nếu có thể; hướng dẫn kết nối và thêm remote."],
  firstmobile: ["Lần đầu · Mobile", "Hướng dẫn ghép nối remote Host từ một máy tính."],
  offline: ["Tất cả Host offline", "Giữ bản nháp; chặn gửi và đưa ra cách kết nối lại."],
  noproject: ["Host chưa có Project", "Host đã online; cần thêm Project trước khi bắt đầu."],
  noprovider: ["Provider chưa sẵn sàng", "Ngữ cảnh đã chọn, cần cài hoặc đăng nhập provider."],
  restricted: [
    "Quyền truy cập thay đổi",
    "Ẩn Project không còn quyền; chỉ chọn ngữ cảnh được phép.",
  ],
  loading: ["Đang khôi phục dữ liệu", "Chờ Host và danh sách Project, tránh fallback quá sớm."],
  noactivity: ["Chưa có hoạt động", "Chat sẵn sàng, phần bên dưới hướng dẫn những bước đầu."],
};
HOME.hosts = [
  {
    id: "local",
    name: "MacBook của Long",
    local: true,
    online: true,
    ready: true,
    projects: ["clisbot", "brain"],
    providers: ["Claude Code", "Codex", "OpenCode"],
    detail: "Local · Máy tính này",
  },
  {
    id: "remote",
    name: "Dev server",
    local: false,
    online: true,
    ready: true,
    projects: ["clisbot", "platform"],
    providers: ["Claude Code", "Codex"],
    detail: "Remote · Kết nối mã hóa",
  },
  {
    id: "lab",
    name: "Lab server",
    local: false,
    online: false,
    ready: true,
    projects: ["experiments"],
    providers: ["OpenCode"],
    detail: "Remote · Offline",
  },
];
HOME.projects = {
  clisbot: { name: "Clisbot", path: "~/Projects/clisbot", color: "ocean", letter: "C" },
  brain: { name: "Second Brain", path: "~/Projects/brain", color: "violet", letter: "B" },
  platform: { name: "Platform", path: "/work/platform", color: "blue", letter: "P" },
  experiments: { name: "Experiments", path: "/work/experiments", color: "amber", letter: "E" },
};
HOME.sessions = [
  {
    id: "s1",
    type: "chat",
    title: "Thiết kế Home mới",
    preview: "Mình đã phác thảo luồng bắt đầu bằng chat…",
    project: "clisbot",
    host: "local",
    provider: "Claude Code",
    status: "idle",
    time: "2 phút trước",
    stamp: 6,
    bot: "Product assistant",
    avatar: "PA",
    color: "ocean",
  },
  {
    id: "s2",
    type: "agent",
    title: "Sửa luồng đăng nhập",
    preview: "Đang kiểm tra các trạng thái kết nối và session.",
    project: "clisbot",
    host: "local",
    provider: "Codex",
    status: "running",
    time: "Đang chạy",
    stamp: 5,
    branch: "fix/auth-flow",
    color: "blue",
  },
  {
    id: "s3",
    type: "agent",
    title: "Review thay đổi channel",
    preview: "Cần anh xem đề xuất trước khi tiếp tục.",
    project: "clisbot",
    host: "remote",
    provider: "Claude Code",
    status: "attention",
    time: "12 phút trước",
    stamp: 4,
    branch: "channel/reliability",
    color: "amber",
  },
  {
    id: "s4",
    type: "chat",
    title: "Kế hoạch tuần tới",
    preview: "Đã tổng hợp 3 ưu tiên và những việc còn mở.",
    project: "brain",
    host: "local",
    provider: "Claude Code",
    status: "idle",
    time: "38 phút trước",
    stamp: 3,
    bot: "Personal assistant",
    avatar: "LA",
    color: "violet",
  },
  {
    id: "s5",
    type: "agent",
    title: "Rà soát API gateway",
    preview: "Hoàn thành lượt review. Có 2 đề xuất cải thiện.",
    project: "platform",
    host: "remote",
    provider: "Codex",
    status: "idle",
    time: "1 giờ trước",
    stamp: 2,
    branch: "main",
    color: "blue",
  },
  {
    id: "s6",
    type: "chat",
    title: "Ý tưởng cho cuối tuần",
    preview: "Danh sách ý tưởng đã lưu để mình xem lại.",
    project: "brain",
    host: "local",
    provider: "Claude Code",
    status: "idle",
    time: "Hôm qua",
    stamp: 1,
    bot: "Personal assistant",
    avatar: "LA",
    color: "violet",
  },
];
HOME.schedules = [
  {
    id: "q1",
    title: "Tổng hợp tiến độ cuối ngày",
    time: "17:30",
    day: "Hôm nay",
    relative: "Còn 2 giờ 10 phút",
    project: "clisbot",
    host: "local",
    type: "Schedule",
    cadence: "Mỗi ngày · 17:30",
    paused: false,
    destination: "Session mới mỗi lần",
    prompt: "Tổng hợp các session trong Project và các việc còn cần phản hồi.",
  },
  {
    id: "q2",
    title: "Kiểm tra channel đang chạy",
    time: "18:00",
    day: "Hôm nay",
    relative: "Còn 2 giờ 40 phút",
    project: "clisbot",
    host: "remote",
    type: "Heartbeat",
    cadence: "Mỗi 3 giờ",
    paused: false,
    destination: "Review thay đổi channel",
    prompt: "Kiểm tra tiến độ và báo lại nếu có lỗi cần xử lý.",
  },
  {
    id: "q3",
    title: "Chuẩn bị ngày làm việc",
    time: "08:30",
    day: "Ngày mai",
    relative: "Sáng mai",
    project: "brain",
    host: "local",
    type: "Heartbeat",
    cadence: "Thứ 2 – Thứ 6 · 08:30",
    paused: false,
    destination: "Kế hoạch tuần tới",
    prompt: "Đọc các ưu tiên đang mở và đề xuất ba việc nên bắt đầu hôm nay.",
  },
];
HOME.status = {
  running: ["Đang chạy", "running"],
  attention: ["Cần phản hồi", "attention"],
  idle: ["Sẵn sàng", "idle"],
  offline: ["Host offline", "offline"],
};
HOME.bots = [
  {
    name: "Product assistant",
    host: "local",
    project: "clisbot",
    provider: "Claude Code",
    avatar: "PA",
  },
  {
    name: "Personal assistant",
    host: "local",
    project: "brain",
    provider: "Claude Code",
    avatar: "LA",
  },
  {
    name: "Product assistant",
    host: "remote",
    project: "clisbot",
    provider: "Claude Code",
    avatar: "PA",
  },
  {
    name: "Platform assistant",
    host: "remote",
    project: "platform",
    provider: "Codex",
    avatar: "PL",
  },
];
HOME.state = {
  concept: "fusion",
  scenario: "returning",
  theme: "light",
  viewport: "desktop",
  mode: "chat",
  filter: "all",
  query: "",
  draft: "",
  files: [],
  selectedHost: null,
  selectedProject: null,
  provider: "Claude Code",
  hosts: [],
  sessions: [],
  schedules: [],
  notice: null,
  dismissed: false,
  connected: false,
  localFound: false,
  localStarted: false,
  providerReady: false,
  projectAdded: false,
  conversation: null,
  loadingDone: false,
};
HOME.availableProjects = (host) => (host ? host.projects.filter((id) => HOME.projects[id]) : []);
HOME.selectedHost = () => HOME.state.hosts.find((host) => host.id === HOME.state.selectedHost);
HOME.isFirst = () => HOME.state.scenario.startsWith("first");
HOME.isLoading = () => HOME.state.scenario === "loading" && !HOME.state.loadingDone;
HOME.selectedBot = () =>
  HOME.bots.find(
    (bot) => bot.host === HOME.state.selectedHost && bot.project === HOME.state.selectedProject,
  );
HOME.canSend = () => {
  const host = HOME.selectedHost();
  return !!(
    host?.online &&
    host.ready &&
    HOME.state.selectedProject &&
    !HOME.isLoading() &&
    (HOME.state.mode === "agent" || HOME.selectedBot())
  );
};
HOME.resolveContext = (previousHost, previousProject) => {
  const state = HOME.state;
  const eligible = state.hosts.filter((host) => host.online);
  const host =
    eligible.find((item) => item.id === previousHost) ||
    eligible.find((item) => item.local) ||
    eligible[0];
  state.selectedHost = host?.id || null;
  const projects = HOME.availableProjects(host);
  state.selectedProject = projects.includes(previousProject)
    ? previousProject
    : projects[0] || null;
  state.provider = host?.providers.includes(state.provider)
    ? state.provider
    : host?.providers[0] || "Claude Code";
  HOME.contextNotice(previousHost, previousProject);
};
HOME.contextNotice = (previousHost, previousProject) => {
  const state = HOME.state;
  if (HOME.isFirst() || HOME.isLoading() || !state.selectedHost) return;
  const host = HOME.selectedHost();
  const project = HOME.projects[state.selectedProject];
  state.notice = null;
  state.dismissed = false;
  if (host.id !== previousHost) {
    state.notice = {
      title: `Đã chọn ${host.name} cho tin nhắn mới`,
      text: `Host gần nhất không khả dụng. Ngữ cảnh mới: ${host.name} · ${project?.name || "chưa có Project"}. Bản nháp được giữ.`,
      action: "Chọn Host khác",
      key: "hosts",
    };
  } else if (previousProject && project && previousProject !== state.selectedProject) {
    state.notice = {
      title: "Project gần nhất không còn khả dụng",
      text: `Đã chọn ${project.name} trên ${host.name}. Kiểm tra Project trước khi gửi.`,
      action: "Đổi Project",
      key: "projects",
    };
  }
};
HOME.applyScenarioFixtures = () => {
  const state = HOME.state;
  const local = state.hosts[0];
  if (state.scenario === "fallback") local.online = false;
  if (state.scenario === "offline")
    state.hosts.forEach((host) => {
      host.online = false;
    });
  if (state.scenario === "projectmissing" || state.scenario === "restricted")
    local.projects = ["brain"];
  if (state.scenario === "restricted") {
    state.sessions = state.sessions.filter(
      (item) => !(item.host === "local" && item.project === "clisbot"),
    );
    state.schedules = state.schedules.filter(
      (item) => !(item.host === "local" && item.project === "clisbot"),
    );
  }
  if (state.scenario === "noproject" && !state.projectAdded) local.projects = [];
  if (state.scenario === "noprovider" && !state.providerReady) local.ready = false;
};
HOME.applyFirstUseFixtures = () => {
  const state = HOME.state;
  const local = state.hosts[0];
  if (state.scenario === "firstdesktop" && !state.localStarted)
    state.hosts = [{ ...local, ready: false, projects: [], providers: [] }];
  if (state.scenario === "firstweb" && !state.localFound && !state.connected) state.hosts = [];
  if (state.scenario === "firstmobile" && !state.connected) state.hosts = [];
  if (state.scenario === "firstweb" && state.localFound) state.hosts = [local];
  if (HOME.isFirst() && state.connected)
    state.hosts = [
      state.hosts.find((host) => host.id === "remote") || structuredClone(HOME.hosts[1]),
    ];
};
HOME.loadScenario = () => {
  const state = HOME.state;
  state.hosts = structuredClone(HOME.hosts);
  const empty = state.scenario === "noactivity" || HOME.isFirst();
  state.sessions = empty ? [] : structuredClone(HOME.sessions);
  state.schedules = empty ? [] : structuredClone(HOME.schedules);
  state.notice = null;
  state.dismissed = false;
  HOME.applyScenarioFixtures();
  HOME.applyFirstUseFixtures();
  HOME.resolveContext("local", "clisbot");
  if (HOME.isLoading()) {
    state.selectedHost = null;
    state.selectedProject = null;
  }
  if (state.scenario === "fallback")
    state.notice = {
      title: "Đã chuyển ngữ cảnh sang Dev server",
      text: "MacBook của Long đang offline. Tin nhắn mới sẽ bắt đầu trên Dev server · Clisbot.",
      action: "Chọn Host khác",
      key: "hosts",
    };
  if (state.scenario === "projectmissing")
    state.notice = {
      title: "Project gần nhất không còn khả dụng",
      text: "Đã chọn Second Brain trên MacBook của Long. Kiểm tra Project trước khi gửi.",
      action: "Đổi Project",
      key: "projects",
    };
  if (state.scenario === "restricted")
    state.notice = {
      title: "Quyền truy cập của anh đã thay đổi",
      text: "Đã chọn Second Brain. Các session và lịch không còn quyền truy cập đã được ẩn.",
      action: "Xem ngữ cảnh",
      key: "projects",
    };
};
