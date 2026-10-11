/* oxlint-disable no-nested-ternary, complexity -- prototype view templates read as one expression per state. */
/* Shared fixture, scenario engine and the Host/Project resolver. Browser-only, no network. */
const H = (window.H = { actions: {}, concept: null });

// ---------- Icons (Lucide paths, the app's icon family) ----------
const P = {
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  history:
    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  automation:
    '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h5"/><path d="M17.5 17.5 16 16.3V14"/><circle cx="16" cy="16" r="6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  server:
    '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/>',
  monitor:
    '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  phone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
  globe:
    '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  shield:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  brain:
    '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  alert:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  offline:
    '<path d="M12 20h.01"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.17-2.65"/><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"/><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68"/><path d="M5 13a10 10 0 0 1 5.24-2.76"/><path d="m2 2 20 20"/>',
  refresh:
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  qr: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  pause:
    '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  play: '<path d="M6 3l14 9-14 9V3z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  list: '<path d="M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  inbox:
    '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  pencil:
    '<path d="M21.17 6.81a1 1 0 0 0-3.98-3.98L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/>',
  branch:
    '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  reply: '<path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  spark:
    '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  notes:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 13H8M16 17H8M16 13h-2"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  external:
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
};
H.icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.chat}</svg>`;
H.logo =
  '<svg class="logo" viewBox="0 0 360 300" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M44 0H246C266 0 280 15 280 35V100H204C174 100 155 122 155 150V172C155 196 145 207 124 207H45C19 207 0 188 0 163V45C0 19 19 0 44 0ZM54 31C44.06 31 36 39.06 36 49C36 58.94 44.06 67 54 67H208C217.94 67 226 58.94 226 49C226 39.06 217.94 31 208 31H54Z"/><path d="M220 135H322C344 135 360 152 360 174V223C360 246 346 263 324 263V289C324 296 320 299 314 294L279 265H205C183 265 166 255 160 240C177 233 188 221 188 203V172C188 150 200 135 220 135Z"/></svg>';
const SVG = /*@PROVIDER_SVGS@*/ {};
H.providers = {
  claude: { name: "Claude Code", model: "Sonnet 5.5", svg: SVG.claude },
  codex: { name: "Codex", model: "GPT-5.6-Luna", svg: SVG.codex },
  opencode: {
    name: "OpenCode",
    model: "Default model",
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 2h16v20H4zM8 6v12h8V6z" fill-rule="evenodd"/></svg>',
  },
  copilot: {
    name: "Copilot",
    model: "Default model",
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="18" height="12" rx="6"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/></svg>',
  },
};
H.pv = (id) => `<span class="pv">${(H.providers[id] || H.providers.opencode).svg}</span>`;
H.esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

// ---------- Fixture ----------
// Snapshot time: Fri 9 Oct 2026, 15:20 (UTC+7). Minutes are relative to it.
H.NOW = "15:20";
function baseData() {
  return {
    hosts: [
      {
        id: "mac",
        name: "LongPro2Max",
        kind: "local",
        status: "online",
        version: "0.11.1",
        via: "This computer",
        providers: { claude: "ready", codex: "ready", opencode: "ready", copilot: "missing" },
        usedAgo: 4,
      },
      {
        id: "dev",
        name: "dev-server",
        kind: "remote",
        status: "online",
        version: "0.11.1",
        via: "Relay",
        providers: { claude: "ready", codex: "ready", opencode: "missing", copilot: "missing" },
        usedAgo: 26,
      },
      {
        id: "studio",
        name: "Studio Mini",
        kind: "remote",
        status: "offline",
        version: "0.11.0",
        via: "Tailscale",
        providers: { claude: "ready", codex: "ready", opencode: "missing", copilot: "missing" },
        usedAgo: 130,
        lastSeen: "2 h ago",
      },
    ],
    projects: [
      { id: "clisbot", hostId: "mac", name: "clisbot", path: "~/projects/clisbot", usedAgo: 4 },
      {
        id: "brain",
        hostId: "mac",
        name: "second-brain",
        path: "~/notes/second-brain",
        usedAgo: 300,
      },
      {
        id: "assistant-home",
        hostId: "mac",
        name: "Product assistant",
        path: "~/.clisbot/bots/product-assistant",
        usedAgo: 12,
        botHome: true,
      },
      {
        id: "platform",
        hostId: "dev",
        name: "platform-api",
        path: "/srv/platform-api",
        usedAgo: 26,
      },
      {
        id: "ops-home",
        hostId: "dev",
        name: "Ops bot",
        path: "/srv/clisbot/bots/ops",
        usedAgo: 900,
        botHome: true,
      },
      {
        id: "mobile",
        hostId: "studio",
        name: "mobile-app",
        path: "~/code/mobile-app",
        usedAgo: 130,
      },
    ],
    bots: [
      {
        id: "product",
        name: "Product assistant",
        initials: "PA",
        hostId: "mac",
        projectId: "assistant-home",
        provider: "claude",
      },
      {
        id: "ops",
        name: "Ops bot",
        initials: "OB",
        hostId: "dev",
        projectId: "ops-home",
        provider: "codex",
      },
    ],
    sessions: [
      {
        id: "s1",
        kind: "agent",
        provider: "codex",
        title: "Fix login redirect loop",
        preview: "Wants approval to run `npm test -- auth`",
        projectId: "clisbot",
        hostId: "mac",
        status: "needs",
        ago: 4,
        ask: "Run npm test -- auth?",
      },
      {
        id: "s2",
        kind: "chat",
        botId: "product",
        title: "Home redesign brief",
        preview: "Drafted three directions and a synthesis.",
        projectId: "assistant-home",
        hostId: "mac",
        status: "idle",
        ago: 12,
      },
      {
        id: "s3",
        kind: "agent",
        provider: "claude",
        title: "Review channel reply hybrid mode",
        preview: "Reading conversation-flow.md and the reply tests…",
        projectId: "platform",
        hostId: "dev",
        status: "running",
        ago: 6,
      },
      {
        id: "s4",
        kind: "agent",
        provider: "codex",
        title: "Upgrade Expo SDK",
        preview: "Paused after updating 14 packages.",
        projectId: "mobile",
        hostId: "studio",
        status: "idle",
        ago: 130,
      },
      {
        id: "s5",
        kind: "agent",
        provider: "opencode",
        title: "Draft release notes",
        preview: "Stopped: provider returned an error.",
        projectId: "clisbot",
        hostId: "mac",
        status: "failed",
        ago: 180,
      },
      {
        id: "s6",
        kind: "chat",
        botId: "ops",
        title: "Weekly incident digest",
        preview: "No new incidents since Monday.",
        projectId: "ops-home",
        hostId: "dev",
        status: "idle",
        ago: 1300,
      },
      {
        id: "s7",
        kind: "agent",
        provider: "claude",
        title: "Sidebar session lines",
        preview: "Merged. Docs updated.",
        projectId: "brain",
        hostId: "mac",
        status: "idle",
        ago: 1500,
      },
    ],
    schedules: [
      {
        id: "k1",
        kind: "Schedule",
        name: "Daily standup summary",
        target: "Product assistant",
        projectId: "assistant-home",
        hostId: "mac",
        at: "17:30",
        day: "Today",
        inMin: 130,
        cadence: "Weekdays at 17:30",
        runIn: "The bot's chat",
      },
      {
        id: "k2",
        kind: "Heartbeat",
        name: "Check channel health",
        target: "Ops bot",
        projectId: "ops-home",
        hostId: "dev",
        at: "15:50",
        day: "Today",
        inMin: 30,
        cadence: "Every 30 minutes",
        runIn: "The bot's chat",
      },
      {
        id: "k3",
        kind: "Schedule",
        name: "Nightly dependency audit",
        target: "Codex",
        projectId: "clisbot",
        hostId: "mac",
        at: "23:00",
        day: "Today",
        inMin: 460,
        cadence: "Daily at 23:00",
        runIn: "A new agent session",
      },
      {
        id: "k4",
        kind: "Schedule",
        name: "Weekly planning",
        target: "Claude Code",
        projectId: "mobile",
        hostId: "studio",
        at: "08:30",
        day: "Tomorrow",
        inMin: 1030,
        cadence: "Saturdays at 08:30",
        runIn: "A new agent session",
      },
      {
        id: "k5",
        kind: "Schedule",
        name: "Release checklist",
        target: "Codex",
        projectId: "platform",
        hostId: "dev",
        at: "10:00",
        day: "Mon",
        inMin: 4000,
        cadence: "Mondays at 10:00",
        runIn: "A new agent session",
        paused: true,
      },
    ],
  };
}

// ---------- Scenarios ----------
// Each scenario is a seed: which device, what the catalog holds, what Home remembers.
const returning = {
  last: { hostId: "mac", projectId: "clisbot", target: { kind: "agent", provider: "codex" } },
  byHost: { mac: "clisbot", dev: "platform", studio: "mobile" },
};
H.scenarios = [
  {
    id: "returning",
    label: "Đã dùng trước đó",
    hint: "Khôi phục Host/Project/agent của lần gửi thành công gần nhất (LongPro2Max › clisbot · Codex).",
    device: null,
    memory: returning,
  },
  {
    id: "host-offline",
    label: "Host gần nhất offline",
    hint: "Lần trước gửi trên Studio Mini › mobile-app. Studio Mini offline → chọn máy này, Project dùng gần nhất trên máy này; báo rõ và giữ draft.",
    device: null,
    memory: {
      ...returning,
      last: {
        hostId: "studio",
        projectId: "mobile",
        target: { kind: "agent", provider: "claude" },
      },
    },
    draft: "Tiếp tục nâng cấp Expo SDK, chạy lại test iOS",
  },
  {
    id: "project-gone",
    label: "Project gần nhất đã bị xóa",
    hint: "dev-server vẫn online nhưng Project “billing-worker” đã bị gỡ → giữ Host, chọn Project dùng gần nhất còn lại trên Host đó.",
    device: null,
    memory: {
      ...returning,
      last: {
        hostId: "dev",
        projectId: "billing-worker",
        target: { kind: "agent", provider: "claude" },
      },
      byHost: { ...returning.byHost, dev: "billing-worker" },
    },
  },
  {
    id: "first-desktop",
    label: "Lần đầu · Desktop app",
    hint: "Desktop app tự quản lý daemon local. Không có lịch sử → chọn máy này, chat ngay; tin đầu tiên tạo trợ lý cá nhân với Project riêng.",
    device: "desktop",
    fresh: true,
  },
  {
    id: "first-desktop-starting",
    label: "Lần đầu · Desktop, local đang khởi động",
    hint: "Daemon local đang khởi động (~2 giây). Cho gõ, chưa cho gửi; tự bật khi sẵn sàng.",
    device: "desktop",
    fresh: true,
    local: "starting",
  },
  {
    id: "first-web-found",
    label: "Lần đầu · Web, tìm thấy local",
    hint: "Web dò localhost:6767. Tìm thấy sau ~1,3 giây → chọn máy này.",
    device: "web",
    fresh: true,
    local: "probing",
  },
  {
    id: "first-web-missing",
    label: "Lần đầu · Web, chưa chạy local",
    hint: "Không thấy daemon trên máy này: hướng dẫn mở Desktop hoặc chạy lệnh, thử lại, hoặc kết nối remote.",
    device: "web",
    fresh: true,
    local: "missing",
  },
  {
    id: "first-web-blocked",
    label: "Lần đầu · Web, trình duyệt chặn local",
    hint: "Trình duyệt chặn truy cập mạng local: chỉ cách cho phép rồi thử lại, hoặc dùng remote.",
    device: "web",
    fresh: true,
    local: "blocked",
  },
  {
    id: "first-mobile",
    label: "Lần đầu · Mobile",
    hint: "Điện thoại không chạy agent. Hướng dẫn ghép nối máy tính bằng QR hoặc link.",
    device: "mobile",
    fresh: true,
  },
  {
    id: "provider-missing",
    label: "Local online, thiếu provider",
    hint: "Máy này online nhưng chưa có agent nào đăng nhập/cài đặt. Hướng dẫn trên Host, không giả vờ gửi được.",
    device: "desktop",
    fresh: true,
    providersMissing: true,
  },
  {
    id: "all-offline",
    label: "Mọi Host offline",
    hint: "Không Host nào kết nối được. Giữ draft, chặn gửi, kết nối lại đúng Host.",
    device: null,
    memory: returning,
    allOffline: true,
    draft: "Tóm tắt PR đang mở",
  },
  {
    id: "busy",
    label: "Nhiều việc cần phản hồi",
    hint: "Hai agent chờ duyệt, một lịch lỗi, một Host offline có lịch sắp chạy.",
    device: null,
    memory: returning,
    busy: true,
  },
];

// ---------- State ----------
const KEY = "clisbot-home-opus";
H.S = null;
H.load = () => {
  const hash = new URLSearchParams(location.hash.slice(1));
  const saved = JSON.parse(sessionStorage.getItem(KEY) || "{}");
  const pick = (k, d) => hash.get(k) || saved[k] || d;
  const ui = {
    scenario: pick("scenario", "returning"),
    device: pick("device", "desktop"),
    theme: pick("theme", "light"),
    notes: pick("notes", "0") === "1",
    hub: pick("hub", "many"),
  };
  H.seed(ui.scenario, ui);
  // A concept with curated variants falls back to its first variant on a link it does not offer.
  const C = H.concept;
  const device = C?.devices && !C.devices.includes(H.S.device) ? C.devices[0] : H.S.device;
  if (C?.variants && (!H.currentVariant() || device !== H.S.device))
    H.seedVariant(H.currentVariant() || C.variants[0], device);
};
H.saveUi = () => {
  const S = H.S;
  const ui = {
    scenario: S.scenario,
    device: S.device,
    theme: S.theme,
    notes: S.notes ? "1" : "0",
    hub: S.hub,
  };
  sessionStorage.setItem(KEY, JSON.stringify(ui));
  history.replaceState(null, "", `#${new URLSearchParams(ui)}`);
};
H.seed = (scenarioId, ui = {}) => {
  const sc = H.scenarios.find((s) => s.id === scenarioId) || H.scenarios[0];
  const data = baseData();
  const device = sc.device || (ui.device && ui.device !== "auto" ? ui.device : "desktop");
  if (sc.fresh) {
    data.sessions = [];
    data.schedules = [];
    data.bots = [];
    data.projects = [];
    data.hosts = device === "mobile" ? [] : [{ ...data.hosts[0], usedAgo: null }];
  }
  if (sc.providersMissing)
    data.hosts[0].providers = {
      claude: "signin",
      codex: "missing",
      opencode: "missing",
      copilot: "missing",
    };
  if (sc.allOffline)
    data.hosts.forEach((h) => {
      h.status = "offline";
      h.lastSeen = h.lastSeen || "6 min ago";
    });
  if (sc.busy) {
    data.sessions.find((s) => s.id === "s3").status = "needs";
    data.sessions.find((s) => s.id === "s3").ask = "Edit 3 files in packages/server?";
    data.sessions.find((s) => s.id === "s3").preview = "Wants to edit 3 files in packages/server";
    data.schedules.unshift({
      id: "k0",
      kind: "Schedule",
      name: "Morning triage",
      target: "Codex",
      projectId: "clisbot",
      hostId: "mac",
      at: "09:00",
      day: "Today",
      inMin: -380,
      cadence: "Weekdays at 09:00",
      runIn: "A new agent session",
      failed: "Codex stopped: rate limit",
    });
  }
  const local = sc.local || (data.hosts.some((h) => h.kind === "local") ? "ready" : "none");
  if (local !== "ready" && data.hosts[0])
    data.hosts[0].status = local === "starting" ? "starting" : "unknown";
  if (local === "probing" || local === "missing" || local === "blocked") data.hosts = [];
  H.S = {
    scenario: sc.id,
    sc,
    device,
    theme: ui.theme || H.S?.theme || "light",
    notes: ui.notes ?? H.S?.notes ?? false,
    // Which Hubs the user has joined; only concepts with an onSeed hook use it.
    hub: ui.hub || H.S?.hub || "many",
    ...data,
    local,
    memory: sc.memory ? structuredClone(sc.memory) : { last: null, byHost: {} },
    draft: sc.draft || "",
    pick: null,
    target: null,
    pop: null,
    sheet: null,
    toast: null,
    filter: "all",
    dismissed: {},
    recentIds: [],
    pair: { method: device === "mobile" ? "qr" : "link", state: "idle" },
    probeCount: 0,
  };
  H.concept?.onSeed?.(H.S);
  H.timers?.forEach(clearTimeout);
  H.timers = [];
  if (local === "starting")
    H.later(2200, () => {
      H.S.hosts[0].status = "online";
      H.S.local = "ready";
      H.toast("LongPro2Max is ready");
    });
  if (local === "probing") H.probe(true);
};
H.later = (ms, fn) =>
  H.timers.push(
    setTimeout(() => {
      fn();
      H.render();
    }, ms),
  );

// ---------- Lookups ----------
H.host = (id) => H.S.hosts.find((h) => h.id === id);
H.project = (id) => H.S.projects.find((p) => p.id === id);
H.bot = (id) => H.S.bots.find((b) => b.id === id);
H.online = (h) => h && h.status === "online";
H.isLocal = (h) => h && h.kind === "local" && H.S.device !== "mobile";
H.hostLabel = (h) =>
  H.isLocal(h) ? (H.S.device === "web" ? "This computer" : "This Mac") : h.name;
H.hostVia = (h) => (H.isLocal(h) ? "Local" : h.via === "This computer" ? "Relay" : h.via);
H.hostIcon = (h) => (H.isLocal(h) ? "monitor" : "server");
H.readyProviders = (h) =>
  h ? Object.keys(h.providers).filter((p) => h.providers[p] === "ready") : [];
H.ago = (m) =>
  m == null
    ? ""
    : m < 1
      ? "now"
      : m < 60
        ? `${m}m`
        : m < 1440
          ? `${Math.round(m / 60)}h`
          : m < 2880
            ? "yesterday"
            : `${Math.round(m / 1440)}d`;
H.inText = (m) =>
  m < 0
    ? "missed"
    : m < 60
      ? `in ${m} min`
      : m < 1440
        ? `in ${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim()
        : "";
H.projectsOn = (hostId, withBotHomes = false) =>
  H.S.projects
    .filter((p) => p.hostId === hostId && !p.scratch && (withBotHomes || !p.botHome))
    .sort((a, b) => a.usedAgo - b.usedAgo);
H.sessionWho = (s) =>
  s.kind === "chat" ? H.bot(s.botId)?.name || "Bot" : H.providers[s.provider]?.name;

// ---------- Context resolver: which Host/Project a NEW message goes to ----------
// Order: manual pick in this draft → last successful send if valid → same Host, its last
// Project → another online Host (local first on Desktop/Web), its last Project → nothing.
// Existing sessions and schedules never move; this only decides the next new message.
H.resolve = () => {
  const S = H.S;
  const out = {
    host: null,
    project: null,
    target: null,
    reason: null,
    notice: null,
    blocker: null,
  };
  const remembered = S.memory.last;
  const target = S.target || remembered?.target || { kind: "starter", provider: "claude" };
  out.target = target;
  if (target.kind === "bot") {
    const bot = H.bot(target.botId);
    out.host = H.host(bot.hostId);
    out.project = H.project(bot.projectId);
    out.reason = "bot";
    if (!H.online(out.host)) out.blocker = { kind: "bot-offline", host: out.host };
    return finish(out);
  }
  const pick = S.pick;
  if (pick && H.online(H.host(pick.hostId))) {
    out.host = H.host(pick.hostId);
    out.project = pick.projectId ? H.project(pick.projectId) : null;
    out.reason = "picked";
    return finish(out);
  }
  const lastHost = remembered && H.host(remembered.hostId);
  const lastProject = remembered && H.project(remembered.projectId);
  if (H.online(lastHost)) {
    out.host = lastHost;
    if (lastProject) {
      out.project = lastProject;
      out.reason = "last";
    } else {
      out.project = H.projectsOn(lastHost.id)[0] || null;
      out.reason = "project-gone";
      out.notice = { kind: "project-gone", from: remembered.projectId, to: out.project };
    }
    return finish(out);
  }
  const online = S.hosts
    .filter(H.online)
    .sort((a, b) => H.isLocal(b) - H.isLocal(a) || (a.usedAgo ?? 1e9) - (b.usedAgo ?? 1e9));
  if (online.length) {
    out.host = online[0];
    const rememberedOnHost = H.project(S.memory.byHost[out.host.id]);
    out.project = rememberedOnHost || H.projectsOn(out.host.id)[0] || null;
    out.reason = remembered ? "host-offline" : "first";
    if (remembered)
      out.notice = { kind: "host-offline", from: lastHost, fromProject: lastProject, to: out.host };
    return finish(out);
  }
  out.reason = remembered ? "host-offline" : "first";
  out.blocker =
    S.local === "starting"
      ? { kind: "starting" }
      : S.local === "probing"
        ? { kind: "probing" }
        : S.local === "missing"
          ? { kind: "web-missing" }
          : S.local === "blocked"
            ? { kind: "web-blocked" }
            : S.device === "mobile" && !S.hosts.length
              ? { kind: "mobile-pair" }
              : { kind: "all-offline" };
  if (S.local === "starting") out.host = S.hosts[0];
  return finish(out);
};
function finish(out) {
  const S = H.S;
  if (out.target.kind === "starter" && out.host) {
    const provider = H.readyProviders(out.host)[0] || "claude";
    // A first message with no Project starts a personal assistant; with a Project it is an agent session.
    out.target = out.project ? { kind: "agent", provider } : { kind: "starter", provider };
  }
  if (
    out.target.kind === "agent" &&
    out.host &&
    H.online(out.host) &&
    out.host.providers[out.target.provider] !== "ready"
  ) {
    const alt = H.readyProviders(out.host)[0];
    if (alt) out.target = { ...out.target, provider: alt, swapped: true };
  }
  if (!out.blocker && out.host && H.online(out.host) && !H.readyProviders(out.host).length)
    out.blocker = { kind: "providers", host: out.host };
  if (!out.blocker && out.target.kind === "agent" && !out.project)
    out.blocker = { kind: "no-project", host: out.host };
  if (out.notice && S.dismissed[out.notice.kind]) out.notice = null;
  out.canSend = !out.blocker;
  return out;
}

// ---------- Derived lists ----------
H.attention = () => {
  const S = H.S;
  const items = [];
  S.sessions
    .filter((s) => s.status === "needs")
    .forEach((s) => items.push({ kind: "needs", s, title: s.title, text: s.ask, ago: s.ago }));
  S.sessions
    .filter((s) => s.status === "failed")
    .forEach((s) => items.push({ kind: "failed", s, title: s.title, text: s.preview, ago: s.ago }));
  S.schedules
    .filter((k) => k.failed)
    .forEach((k) => items.push({ kind: "run-failed", k, title: k.name, text: k.failed, ago: 380 }));
  S.hosts
    .filter((h) => h.status === "offline")
    .forEach((h) => {
      const sessions = S.sessions.filter((s) => s.hostId === h.id).length;
      const sched = S.schedules.filter((k) => k.hostId === h.id && !k.paused).length;
      if (sessions + sched)
        items.push({
          kind: "offline",
          h,
          title: `${h.name} is offline`,
          text: `${[sessions && `${sessions} session`, sched && `${sched} upcoming run`].filter(Boolean).join(" · ")} · last seen ${h.lastSeen}`,
        });
    });
  return items;
};
H.recent = (filter = H.S.filter) =>
  H.S.sessions
    .filter((s) => filter === "all" || (filter === "chat" ? s.kind === "chat" : s.kind === "agent"))
    .sort((a, b) => a.ago - b.ago);
H.upcoming = () =>
  H.S.schedules.filter((k) => !k.failed).sort((a, b) => a.paused - b.paused || a.inMin - b.inMin);

// ---------- Simulated host operations ----------
H.probe = (first) => {
  const S = H.S;
  S.local = "probing";
  S.probeCount += 1;
  // Demo: the automatic first probe only succeeds in "found"; "Look again" assumes the user fixed it.
  const findsIt = S.sc.id === "first-web-found" || !first;
  H.later(1300, () => {
    if (findsIt) {
      const mac = baseData().hosts[0];
      H.S.hosts = [{ ...mac, usedAgo: null }, ...H.S.hosts.filter((h) => h.id !== "mac")];
      H.S.local = "ready";
      H.toast("Found Clisbot on this computer");
    } else H.S.local = S.sc.local === "blocked" ? "blocked" : "missing";
  });
  if (!first) H.render();
};
H.reconnect = (hostId) => {
  const h = H.host(hostId);
  h.status = "connecting";
  H.later(1200, () => {
    h.status = "online";
    H.toast(`${H.hostLabel(h)} is back online`);
  });
};
H.pairDone = () => {
  const S = H.S;
  // The paired computer arrives with the Projects it already has.
  const mac = { ...baseData().hosts[0], kind: "remote", via: "Relay", usedAgo: null };
  if (S.device !== "mobile") Object.assign(mac, { id: "paired", name: "Office iMac" });
  S.hosts = [...S.hosts.filter((h) => h.id !== mac.id), mac];
  if (!S.projects.some((p) => p.hostId === mac.id)) {
    S.projects.push({
      id: `${mac.id}-site`,
      hostId: mac.id,
      name: S.device === "mobile" ? "clisbot" : "website",
      path: "~/projects",
      usedAgo: 60,
    });
  }
  S.pick = { hostId: mac.id, projectId: H.projectsOn(mac.id)[0]?.id || null };
  if (S.device === "mobile") {
    S.local = "none";
  }
  S.sheet = null;
  H.toast(`Connected to ${mac.name}`);
};

// ---------- Sending ----------
H.send = () => {
  const S = H.S;
  const ctx = H.resolve();
  const text = S.draft.trim();
  if (!ctx.canSend || !text) return;
  let { project, target } = ctx;
  if (target.kind === "starter" && H.concept.quickChatProject) {
    // A concept may run "No project" chats in a scratch folder on the Host instead of creating a Bot.
    project = H.concept.quickChatProject(ctx.host);
    target = { kind: "agent", provider: target.provider };
  } else if (target.kind === "starter") {
    // First message: create a personal assistant Bot; its home folder is its own Project.
    project = {
      id: "personal-home",
      hostId: ctx.host.id,
      name: "Personal assistant",
      path: "~/.clisbot/bots/personal-assistant",
      usedAgo: 0,
      botHome: true,
    };
    S.projects.push(project);
    S.bots.push({
      id: "personal",
      name: "Personal assistant",
      initials: "PA",
      hostId: ctx.host.id,
      projectId: project.id,
      provider: target.provider,
    });
    target = { kind: "bot", botId: "personal" };
  }
  const s = {
    id: `n${Date.now()}`,
    kind: target.kind === "bot" ? "chat" : "agent",
    botId: target.botId,
    provider: target.provider,
    title: text.length > 52 ? `${text.slice(0, 50)}…` : text,
    preview: "Working…",
    projectId: project?.id,
    hostId: ctx.host.id,
    status: "running",
    ago: 0,
  };
  S.sessions.unshift(s);
  S.recentIds = [s.id];
  S.memory.last = { hostId: ctx.host.id, projectId: project?.id, target };
  if (project && !project.botHome) S.memory.byHost[ctx.host.id] = project.id;
  ctx.host.usedAgo = 0;
  if (project) project.usedAgo = 0;
  S.draft = "";
  S.pick = null;
  S.target = null;
  S.dismissed = {};
  H.toast(`Started on ${H.hostLabel(ctx.host)} › ${project?.name}`, s.id);
  H.later(2600, () => {
    s.status = "idle";
    s.preview = "Replied · open to continue";
  });
};
H.toast = (text, sessionId) => {
  H.S.toast = { text, sessionId };
  clearTimeout(H.toastTimer);
  H.toastTimer = setTimeout(() => {
    H.S.toast = null;
    H.render();
  }, 3800);
};
