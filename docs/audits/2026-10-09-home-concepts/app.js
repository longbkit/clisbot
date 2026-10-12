/* All actions operate on browser-only fixtures. Nothing is sent to a service. */
HOME.ui = {};
HOME.ui.toastTimer = null;
HOME.ui.lastFocus = null;
HOME.ui.toast = (message) => {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(HOME.ui.toastTimer);
  HOME.ui.toastTimer = setTimeout(() => toast.classList.remove("visible"), 3500);
};
HOME.ui.save = () => {
  try {
    sessionStorage.setItem(
      "clisbot-home-design-v1",
      JSON.stringify({
        concept: HOME.state.concept,
        theme: HOME.state.theme,
        viewport: HOME.state.viewport,
        draft: HOME.state.draft,
        lastUsed: HOME.state.lastUsed,
      }),
    );
  } catch {
    /* Storage can be unavailable for file URLs. */
  }
};
HOME.ui.render = () => {
  const state = HOME.state;
  document.body.classList.toggle("dark", state.theme === "dark");
  const app = document.querySelector("#app");
  app.className = `app-shell ${state.concept} ${["focus", "pulse"].includes(state.concept) ? "rail" : ""} ${state.viewport === "mobile" ? "mobile-mode" : ""}`;
  app.innerHTML = HOME.view.shell();
  document.querySelectorAll("[data-concept]").forEach((button) => {
    const selected = button.dataset.concept === state.concept;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-current", selected ? "page" : "false");
  });
  document.querySelector('[data-action="viewport"]').innerHTML = HOME.icon(
    state.viewport === "mobile" ? "host" : "phone",
  );
  document
    .querySelector('[data-action="viewport"]')
    .classList.toggle("active", state.viewport === "mobile");
  document.querySelector('[data-action="theme"]').innerHTML = HOME.icon(
    state.theme === "dark" ? "sun" : "moon",
  );
  document.querySelector("#scenario-description").textContent = HOME.scenarios[state.scenario][1];
  document.querySelector("#scenario").value = state.scenario;
  document.querySelector("#concept-note").innerHTML = HOME.view.note();
  HOME.ui.save();
};
HOME.ui.open = (title, subtitle, body, footer = "", cls = "") => {
  const modal = document.querySelector("#modal");
  if (!modal.open) HOME.ui.lastFocus = document.activeElement;
  modal.className = cls;
  modal.innerHTML = `<div class="modal-head"><div><h2 id="modal-title">${title}</h2><p>${subtitle}</p></div><button class="icon-button" data-action="close-modal" aria-label="Đóng">${HOME.icon("close")}</button></div><div class="modal-body">${body}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ""}`;
  if (!modal.open) modal.showModal();
};
HOME.ui.close = () => {
  const modal = document.querySelector("#modal");
  const wasSearch = !!modal.querySelector("#session-search");
  modal.close();
  if (wasSearch) HOME.ui.render();
  const previous = HOME.ui.lastFocus;
  if (previous?.isConnected) previous.focus();
  else document.querySelector("#prompt")?.focus({ preventScroll: true });
};
HOME.ui.demoNote =
  '<div class="prototype-note">Bản thiết kế tương tác · dữ liệu minh họa. Thao tác ở đây chỉ thay đổi bản demo trong trình duyệt.</div>';
HOME.ui.button = (action, label, primary = false, id = "") =>
  `<button class="${primary ? "primary-button" : "secondary-button"}" data-action="${action}" ${id ? `data-id="${id}"` : ""}>${label}</button>`;
HOME.ui.hosts = () => {
  const state = HOME.state;
  const rows = state.hosts
    .map(
      (host) =>
        `<button class="picker-row ${state.selectedHost === host.id ? "selected" : ""}" data-action="${host.online ? "pick-host" : "host-detail"}" data-id="${host.id}">${HOME.icon(host.local ? "host" : "remote")}<span class="picker-copy"><span class="picker-title">${HOME.esc(host.name)}</span><small>${host.detail} · ${host.online ? "Online" : "Offline · Xem để kết nối lại"}</small></span>${state.selectedHost === host.id ? HOME.icon("check") : ""}</button>`,
    )
    .join("");
  HOME.ui.open(
    "Chọn Host",
    "Host quyết định máy tính chạy cuộc trò chuyện mới. Session đang có luôn giữ Host gốc.",
    (rows || "<p>Chưa có Host được kết nối.</p>") +
      '<button class="modal-inline-action" data-action="connect">+ Kết nối remote Host</button>' +
      (!state.hosts.some((h) => h.online) && state.hosts.length
        ? '<button class="modal-inline-action" data-action="reconnect">↻ Kết nối lại Host đã lưu</button>'
        : ""),
  );
};
HOME.ui.projects = () => {
  const host = HOME.selectedHost();
  const ids = HOME.availableProjects(host);
  const rows = ids
    .map(
      (id) =>
        `<button class="picker-row ${HOME.state.selectedProject === id ? "selected" : ""}" data-action="pick-project" data-id="${id}">${HOME.view.projectMark(id)}<span class="picker-copy"><span class="picker-title">${HOME.esc(HOME.projects[id].name)}</span><small>${HOME.esc(HOME.projects[id].path)}</small></span>${id === HOME.state.selectedProject ? HOME.icon("check") : ""}</button>`,
    )
    .join("");
  HOME.ui.open(
    "Chọn Project",
    host
      ? `Các Project khả dụng trên ${HOME.esc(host.name)}. Chat sẽ dùng Bot thuộc Project đã chọn.`
      : "Chọn một Host online trước khi chọn Project.",
    (rows || "<p>Chưa có Project khả dụng.</p>") +
      `<button class="modal-inline-action" data-action="${host ? "add-project" : "hosts"}">${host ? "+ Thêm Project" : "Chọn Host →"}</button>`,
  );
};
HOME.ui.providers = () => {
  const host = HOME.selectedHost();
  if (!host?.online || !host.ready) {
    HOME.ui.actions["provider-setup"]();
    return;
  }
  const rows = host.providers
    .map(
      (name) =>
        `<button class="picker-row ${HOME.state.provider === name ? "selected" : ""}" data-action="pick-provider" data-id="${name}">${HOME.icon("terminal")}<span class="picker-copy"><span class="picker-title">${name}</span><small>Đã sẵn sàng trên ${HOME.esc(host.name)}</small></span>${name === HOME.state.provider ? HOME.icon("check") : ""}</button>`,
    )
    .join("");
  HOME.ui.open(
    "Provider cho Agent session mới",
    "Lựa chọn này áp dụng khi tạo Agent session. Chat dùng provider của Bot.",
    rows,
  );
};
HOME.ui.bots = () => {
  const state = HOME.state;
  const bots = HOME.bots.filter((bot) =>
    state.hosts.find((host) => host.id === bot.host)?.projects.includes(bot.project),
  );
  const rows = bots
    .map(
      (bot, i) =>
        `<button class="picker-row ${bot === HOME.selectedBot() ? "selected" : ""}" data-action="pick-bot" data-id="${i}" ${state.hosts.find((h) => h.id === bot.host)?.online ? "" : "disabled"}><span class="avatar ${HOME.projects[bot.project].color}">${HOME.esc(bot.avatar)}</span><span class="picker-copy"><span class="picker-title">${HOME.esc(bot.name)}</span><small>${HOME.esc(HOME.projects[bot.project].name)} · ${HOME.esc(state.hosts.find((h) => h.id === bot.host)?.name)} · ${HOME.esc(bot.provider)}</small></span>${bot === HOME.selectedBot() ? HOME.icon("check") : ""}</button>`,
    )
    .join("");
  HOME.ui.open(
    "Chat với Bot nào?",
    "Mỗi Bot có Project và provider riêng. Chọn Bot sẽ chọn đúng ngữ cảnh của Bot đó.",
    rows + '<button class="modal-inline-action" data-action="new-bot">+ Tạo Bot mới</button>',
  );
};
HOME.ui.context = () => {
  const state = HOME.state;
  const host = HOME.selectedHost();
  const bot = HOME.selectedBot();
  const project = HOME.projects[state.selectedProject];
  HOME.ui.open(
    "Ngữ cảnh của tin nhắn mới",
    "Kiểm tra nơi chạy và cách bắt đầu trước khi gửi.",
    `<dl class="detail-grid"><dt>Host</dt><dd>${HOME.esc(host?.name || "Chưa chọn")}</dd><dt>Project</dt><dd>${project?.name || "Chưa chọn"}</dd><dt>Cách bắt đầu</dt><dd>${state.mode === "chat" ? "Chat mới với Bot" : "Agent session mới"}</dd><dt>${state.mode === "chat" ? "Bot" : "Workspace"}</dt><dd>${state.mode === "chat" ? bot?.name || "Chưa chọn" : "Workspace mặc định của Project"}</dd><dt>Provider</dt><dd>${state.mode === "chat" ? bot?.provider || "Theo Bot" : state.provider}</dd><dt>Trạng thái</dt><dd>${HOME.canSend() ? "Sẵn sàng gửi" : "Cần hoàn tất thiết lập"}</dd></dl><p>Lựa chọn gần nhất được nhớ sau khi gửi thành công. Nếu không còn khả dụng, Home đề xuất ngữ cảnh mới và cho anh kiểm tra trước khi gửi.</p>`,
    HOME.ui.button("hosts", "Đổi Host") + HOME.ui.button("projects", "Đổi Project"),
  );
};
HOME.ui.connect = () => {
  const mobile = HOME.state.scenario === "firstmobile";
  HOME.ui.open(
    mobile ? "Kết nối máy tính của anh" : "Thêm remote Host",
    "Tiếp tục làm việc trên máy tính từ bất kỳ thiết bị nào.",
    `<div class="step-list"><div class="step"><span class="step-number">1</span><div><strong>Mở Clisbot trên máy tính</strong>Chọn Host mà anh muốn kết nối và mở mục ghép nối thiết bị.</div></div><div class="step"><span class="step-number">2</span><div><strong>Lấy lời mời ghép nối</strong>Dùng mã QR hoặc liên kết ghép nối do máy tính tạo.</div></div><div class="step"><span class="step-number">3</span><div><strong>Kết nối trên thiết bị này</strong>${mobile ? "Quét QR hoặc dán liên kết bên dưới." : "Dán liên kết ghép nối bên dưới."}</div></div></div><label class="form-label" for="pairing-link">Liên kết ghép nối</label><input class="form-input" id="pairing-link" placeholder="Dán liên kết từ Host của anh" autocomplete="off" />${mobile ? '<button class="outline-button" data-action="scan-demo">Thử quét QR mẫu</button>' : ""}${HOME.ui.demoNote}`,
    HOME.ui.button("close-modal", "Để sau") +
      HOME.ui.button("connect-demo", "Dùng remote Host mẫu", true),
  );
};
HOME.ui.session = (id) => {
  const session = HOME.state.sessions.find((item) => item.id === id);
  if (!session) return;
  const host = HOME.state.hosts.find((h) => h.id === session.host);
  const offline = !host?.online;
  const proposal =
    session.status === "attention"
      ? `<div class="notice">${HOME.icon("info")}<div class="notice-copy"><strong>Cần anh xem đề xuất</strong><p>Agent muốn tiếp tục sửa luồng retry trong channel. Mở chi tiết để đọc phạm vi thay đổi.</p><button class="text-action" data-action="review-proposal" data-id="${id}">Xem đề xuất →</button></div></div>`
      : "";
  HOME.ui.open(
    HOME.esc(session.title),
    `${session.type === "chat" ? "Chat" : "Agent session"} · ${HOME.esc(HOME.projects[session.project].name)} · ${HOME.esc(host?.name || "Host không khả dụng")}`,
    `<dl class="detail-grid"><dt>Provider</dt><dd>${session.provider}</dd><dt>Trạng thái</dt><dd>${HOME.view.status(session)}</dd>${session.branch ? `<dt>Branch</dt><dd>${session.branch}</dd>` : `<dt>Bot</dt><dd>${HOME.esc(session.bot)}</dd>`}</dl>${proposal}<div class="conversation-bubble"><div class="bubble-name">${session.type === "chat" ? HOME.esc(session.bot) : session.provider}</div>${HOME.esc(session.preview)}</div>${offline ? "<p>Host gốc đang offline. Kết nối lại để tiếp tục session này; session sẽ không được chuyển sang Host khác.</p>" : `<label class="form-label" for="session-message">Tiếp tục cuộc trò chuyện</label><div class="mini-composer"><textarea id="session-message" placeholder="Nhắn tiếp trong session này…" aria-label="Tin nhắn tiếp tục session"></textarea><button class="send-button" data-action="resume-session" data-id="${id}" aria-label="Gửi trong session">${HOME.icon("arrow")}</button></div>`}${HOME.ui.demoNote}`,
    offline
      ? HOME.ui.button("hosts", "Xem Host gốc") +
          HOME.ui.button("reconnect-session", "Kết nối lại Host", true, id)
      : "",
  );
};
HOME.ui.schedule = (id) => {
  const schedule = HOME.state.schedules.find((s) => s.id === id);
  if (!schedule) return;
  const host = HOME.state.hosts.find((h) => h.id === schedule.host);
  HOME.ui.open(
    schedule.title,
    `${schedule.type} · ${HOME.esc(HOME.projects[schedule.project].name)}`,
    `<dl class="detail-grid"><dt>Lần tiếp theo</dt><dd>${schedule.paused ? "Đã tạm dừng" : `${schedule.day} · ${HOME.esc(schedule.time)}`}</dd><dt>Lặp lại</dt><dd>${HOME.esc(schedule.cadence)}</dd><dt>Múi giờ</dt><dd>Asia/Ho_Chi_Minh (UTC+7)</dd><dt>Host</dt><dd>${HOME.esc(host?.name)} · ${host?.online ? "Online" : "Offline"}</dd><dt>Run in</dt><dd>${HOME.esc(schedule.destination)}</dd></dl><div class="conversation-bubble"><div class="bubble-name">Nội dung</div>${HOME.esc(schedule.prompt)}</div>${!host?.online ? "<p>Host đang offline. Lịch không tự chuyển sang Host khác.</p>" : ""}${HOME.ui.demoNote}`,
    HOME.ui.button("automations", "Xem các lịch") +
      HOME.ui.button("pause-schedule", schedule.paused ? "Tiếp tục lịch" : "Tạm dừng", false, id),
  );
};
HOME.ui.automations = () =>
  HOME.ui.open(
    "Schedules & Heartbeats",
    "Lịch trên các Host và Project anh có quyền quản lý.",
    HOME.state.schedules.map(HOME.view.scheduleRow).join("") ||
      "<p>Chưa có lịch. Tạo lịch đầu tiên để Clisbot làm việc định kỳ.</p>",
    HOME.ui.button("new-schedule", "Tạo lịch"),
  );
HOME.ui.search = () => {
  HOME.ui.open(
    "Tìm công việc gần đây",
    "Tìm theo tên session, Bot, provider hoặc Project.",
    `<label class="form-label" for="session-search">Tìm kiếm</label><input class="form-input" id="session-search" placeholder="Tên session, Bot, Project…" value="${HOME.esc(HOME.state.query)}" /><div id="search-results" class="session-list">${HOME.view.filteredSessions().map(HOME.view.session).join("") || "<p>Chưa có session phù hợp.</p>"}</div>`,
  );
  document.querySelector("#session-search").focus();
};
HOME.ui.compare = () => {
  const ids = ["focus", "workspace", "pulse", "fusion"];
  const rows = [
    [
      "Điểm bắt đầu",
      "Composer lớn ở giữa",
      "Composer trong ngữ cảnh Project",
      "Composer rồi đến nhịp hoạt động",
      "Composer ở trên, ngữ cảnh ngay tại chỗ",
    ],
    [
      "Session gần đây",
      "Thẻ Chat / Agent dễ chọn",
      "Nhóm theo Project",
      "Theo dòng thời gian",
      "Danh sách gọn, lọc Chat / Agent",
    ],
    [
      "Lịch sắp tới",
      "Nhóm hôm nay / ngày mai",
      "Cạnh session của Project",
      "Thời gian và trạng thái rõ",
      "Nhóm thời gian, giữ Run in & Host",
    ],
    [
      "Cần chú ý",
      "Thẻ nhỏ bên phải",
      "Gắn với công việc",
      "Tóm tắt nổi bật",
      "Desktop bên phải; mobile lên đầu phần bên dưới",
    ],
    [
      "Lần đầu & fallback",
      "Hướng dẫn ngay trên composer",
      "Ngữ cảnh trước khi gửi",
      "Trạng thái kết nối có thể hành động",
      "Local cho desktop/web, remote cho mobile; đổi có thông báo",
    ],
    ["Phù hợp nhất", ...ids.map((id) => HOME.concepts[id].audience)],
    ["Đánh đổi", ...ids.map((id) => HOME.concepts[id].tradeoff)],
  ];
  const table = `<div class="comparison-scroll"><table class="compare-table"><thead><tr><th>Tiêu chí</th>${ids.map((id) => `<th>${HOME.concepts[id].number} · ${HOME.concepts[id].title}<small>${HOME.concepts[id].accent}</small></th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  HOME.ui.open(
    "Bốn hướng. Cùng một mục tiêu.",
    "Đưa chat ra phía trước và giảm công sức chọn nơi bắt đầu.",
    table,
    HOME.ui.button("use-fusion", "Xem phương án tổng hợp"),
    "compare-dialog",
  );
};
HOME.ui.designDetail = () => {
  const c = HOME.concepts[HOME.state.concept];
  HOME.ui.open(
    `${c.number} · ${c.title}`,
    c.accent,
    `<div class="design-detail"><p>${c.description}</p><div class="principle">${c.strengths.join(" · ")}</div><h3>Trải nghiệm đầy đủ</h3><ul><li>Chat với Bot hoặc bắt đầu Agent session ngay trên Home.</li><li>Host → Project → Bot / provider luôn được nhìn thấy trước khi gửi.</li><li>Nhớ lựa chọn sau lần gửi thành công. Kiểm tra online, quyền và dữ liệu trước khi fallback.</li><li>Desktop ưu tiên local; web thử local rồi có kết nối thủ công; mobile ghép nối remote.</li><li>Session gần đây có loại, Project, Host, trạng thái và bước tiếp tục.</li><li>Lịch nhóm hôm nay / ngày mai, cho biết nơi chạy và Host offline.</li><li>Việc cần phản hồi, lỗi kết nối, thiếu Project / provider có hành động phục hồi.</li><li>Bản nháp giữ khi đổi concept, ngữ cảnh hoặc Host; có tìm kiếm, tệp và nhập giọng nói minh họa.</li><li>Mobile đưa việc cần chú ý lên trước session; các phần còn lại xếp một cột.</li></ul><h3>Phù hợp</h3><p>${c.audience}</p><h3>Đánh đổi</h3><p>${c.tradeoff}</p><h3>Quy tắc giữ chất lượng</h3><p>Home chỉ chọn ngữ cảnh cho cuộc trò chuyện mới. Khi mở một session hoặc lịch đã có, dùng đúng Host và Project gốc. Không đổi ngữ cảnh trong lúc người dùng đang nhập mà không báo rõ.</p>${HOME.ui.demoNote}</div>`,
    HOME.ui.button("compare", "So sánh các hướng"),
  );
};
HOME.ui.send = () => {
  const state = HOME.state;
  if (!HOME.canSend() || !state.draft.trim()) return;
  const bot = HOME.selectedBot();
  const text = state.draft.trim();
  const session = {
    id: `demo-${Date.now()}`,
    type: state.mode,
    title: text.length > 55 ? `${text.slice(0, 55)}…` : text,
    preview: "Đã nhận tin nhắn. Đây là phiên minh họa trong bản thiết kế.",
    project: state.selectedProject,
    host: state.selectedHost,
    provider: state.mode === "chat" ? bot.provider : state.provider,
    status: "running",
    time: "Vừa xong",
    stamp: Date.now(),
    bot: bot?.name || "",
    avatar: bot?.avatar || "AI",
    color: HOME.projects[state.selectedProject].color,
  };
  state.sessions.unshift(session);
  state.lastUsed = { host: state.selectedHost, project: state.selectedProject };
  state.draft = "";
  state.files = [];
  state.query = "";
  state.filter = "all";
  HOME.ui.render();
  HOME.ui.open(
    state.mode === "chat" ? "Cuộc trò chuyện mới" : "Agent session mới",
    `${HOME.esc(HOME.projects[session.project].name)} · ${HOME.esc(HOME.selectedHost().name)} · ${session.provider}`,
    `<div class="conversation-bubble user"><div class="bubble-name">Long</div>${HOME.esc(text)}</div><div class="conversation-bubble"><div class="bubble-name">${state.mode === "chat" ? HOME.esc(bot.name) : session.provider}</div>Mình đã nhận được yêu cầu trong đúng ngữ cảnh đã chọn. Session mới đã xuất hiện trong phần công việc gần đây.</div>${HOME.ui.demoNote}`,
    HOME.ui.button("close-modal", "Về Home") +
      HOME.ui.button("session", "Mở session", false, session.id),
  );
};
HOME.ui.form = (kind) => {
  const host = HOME.selectedHost();
  if (!host?.online) {
    HOME.ui.hosts();
    return;
  }
  if (kind !== "project" && !HOME.state.selectedProject) {
    HOME.ui.projects();
    return;
  }
  const names = {
    project: ["Thêm Project", "Project"],
    bot: ["Tạo Bot", "Bot"],
    schedule: ["Tạo lịch", "Lịch"],
  };
  const [title, noun] = names[kind];
  const fields = {
    project:
      '<label class="form-label" for="new-path">Đường dẫn trên Host</label><input class="form-input" id="new-path" placeholder="~/Projects/my-project" />',
    schedule:
      '<label class="form-label" for="new-time">Giờ chạy mỗi ngày</label><input class="form-input" id="new-time" type="time" value="19:00" /><label class="form-label" for="new-cadence">Run in</label><select class="form-input" id="new-cadence"><option>Session mới mỗi lần</option></select><label class="form-label" for="new-instructions">Nội dung</label><textarea class="form-input" id="new-instructions" placeholder="Clisbot cần làm gì theo lịch?"></textarea>',
    bot: '<label class="form-label" for="new-role">Vai trò</label><input class="form-input" id="new-role" placeholder="Trợ lý hỗ trợ công việc trong Project" />',
  };
  const extra = fields[kind];
  HOME.ui.open(
    title,
    `${HOME.esc(host.name)}${kind !== "project" ? ` · ${HOME.esc(HOME.projects[HOME.state.selectedProject].name)}` : ""}`,
    `<label class="form-label" for="new-name">Tên ${noun}</label><input class="form-input" id="new-name" placeholder="Đặt một tên dễ nhớ" />${extra}${HOME.ui.demoNote}`,
    HOME.ui.button("close-modal", "Để sau") +
      HOME.ui.button(`create-${kind}`, `Tạo ${noun} mẫu`, true),
  );
};
HOME.ui.create = (kind) => {
  const name = document.querySelector("#new-name").value.trim();
  if (!name) {
    document.querySelector("#new-name").focus();
    return;
  }
  const state = HOME.state;
  const host = HOME.selectedHost();
  if (kind === "project") {
    const path = document.querySelector("#new-path").value.trim();
    if (!path) {
      document.querySelector("#new-path").focus();
      return;
    }
    const id = `project-${Date.now()}`;
    HOME.projects[id] = { name, path, color: "ocean", letter: name[0].toUpperCase() };
    host.projects.push(id);
    state.selectedProject = id;
    state.projectAdded = true;
    state.mode = "agent";
  } else if (kind === "bot") {
    HOME.bots.unshift({
      name,
      host: host.id,
      project: state.selectedProject,
      provider: state.provider,
      avatar: name.slice(0, 2).toUpperCase(),
    });
    state.mode = "chat";
  } else {
    const time = document.querySelector("#new-time").value;
    const prompt = document.querySelector("#new-instructions").value.trim();
    if (!time || !prompt) {
      document.querySelector(!time ? "#new-time" : "#new-instructions").focus();
      return;
    }
    state.schedules.push({
      id: `schedule-${Date.now()}`,
      title: name,
      time,
      day: time > "15:20" ? "Hôm nay" : "Ngày mai",
      relative: "Lịch mẫu mới",
      project: state.selectedProject,
      host: host.id,
      type: "Schedule",
      cadence: `Mỗi ngày · ${time}`,
      paused: false,
      destination: "Session mới mỗi lần",
      prompt,
    });
    state.schedules.sort((a, b) => a.time.localeCompare(b.time));
  }
  HOME.ui.close();
  HOME.ui.render();
  HOME.ui.toast("Đã thêm vào bản demo. Anh có thể tiếp tục trải nghiệm.");
};
HOME.ui.pickContext = (kind, id) => {
  const state = HOME.state;
  const previous = state.selectedProject;
  if (kind === "host") {
    const host = state.hosts.find((h) => h.id === id && h.online);
    if (!host) return;
    state.selectedHost = id;
    const projects = HOME.availableProjects(host);
    state.selectedProject = projects.includes(previous) ? previous : projects[0] || null;
    if (!host.providers.includes(state.provider))
      state.provider = host.providers[0] || "Claude Code";
  } else if (kind === "project") state.selectedProject = id;
  else if (kind === "provider") state.provider = id;
  else {
    const bots = HOME.bots.filter((b) =>
      state.hosts.find((h) => h.id === b.host)?.projects.includes(b.project),
    );
    const bot = bots[Number(id)];
    if (!bot) return;
    state.selectedHost = bot.host;
    state.selectedProject = bot.project;
    state.mode = "chat";
  }
  state.dismissed = true;
  if (state.mode === "chat" && !HOME.selectedBot()) state.mode = "agent";
  HOME.ui.close();
  HOME.ui.render();
  HOME.ui.toast("Đã đổi ngữ cảnh cho tin nhắn mới. Bản nháp được giữ.");
};
