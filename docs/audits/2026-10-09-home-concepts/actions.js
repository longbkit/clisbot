HOME.ui.actions = {
  home: () => {
    HOME.ui.close();
    document.querySelector("#home-title").scrollIntoView({ behavior: "smooth", block: "center" });
  },
  "close-modal": HOME.ui.close,
  hosts: HOME.ui.hosts,
  projects: HOME.ui.projects,
  providers: HOME.ui.providers,
  bots: HOME.ui.bots,
  context: HOME.ui.context,
  connect: HOME.ui.connect,
  compare: HOME.ui.compare,
  "design-detail": HOME.ui.designDetail,
  search: HOME.ui.search,
  automations: HOME.ui.automations,
  send: HOME.ui.send,
  "add-project": () => HOME.ui.form("project"),
  "new-bot": () => HOME.ui.form("bot"),
  "new-schedule": () => HOME.ui.form("schedule"),
  "create-project": () => HOME.ui.create("project"),
  "create-bot": () => HOME.ui.create("bot"),
  "create-schedule": () => HOME.ui.create("schedule"),
  "pick-host": (id) => HOME.ui.pickContext("host", id),
  "pick-project": (id) => HOME.ui.pickContext("project", id),
  "pick-provider": (id) => HOME.ui.pickContext("provider", id),
  "pick-bot": (id) => HOME.ui.pickContext("bot", id),
  session: HOME.ui.session,
  schedule: HOME.ui.schedule,
  dismiss: () => {
    HOME.state.dismissed = true;
    HOME.ui.render();
  },
  filter: (id) => {
    HOME.state.filter = id;
    HOME.state.showAll = false;
    HOME.ui.render();
  },
  "clear-search": () => {
    HOME.state.query = "";
    HOME.ui.render();
  },
  "show-all": () => {
    HOME.state.showAll = true;
    HOME.ui.render();
  },
  "focus-prompt": () => {
    HOME.ui.close();
    document.querySelector("#prompt").focus();
  },
  "mode-chat": () => {
    HOME.state.mode = "chat";
    HOME.ui.render();
  },
  "mode-agent": () => {
    HOME.state.mode = "agent";
    HOME.ui.render();
  },
  viewport: () => {
    HOME.state.viewport = HOME.state.viewport === "mobile" ? "desktop" : "mobile";
    HOME.ui.render();
  },
  theme: () => {
    HOME.state.theme = HOME.state.theme === "light" ? "dark" : "light";
    HOME.ui.render();
  },
  reset: () => HOME.ui.resetScenario(HOME.state.scenario),
  "use-fusion": () => {
    HOME.state.concept = "fusion";
    HOME.ui.close();
    HOME.ui.render();
  },
  history: () =>
    HOME.ui.open(
      "Tất cả session gần đây",
      "Chat và Agent session giữ ngữ cảnh Host và Project ban đầu.",
      `<div class="session-list">${
        HOME.state.sessions
          .sort((a, b) => b.stamp - a.stamp)
          .map(HOME.view.session)
          .join("") || "<p>Chưa có session. Bắt đầu một cuộc trò chuyện trên Home.</p>"
      }</div>`,
    ),
  attention: () =>
    HOME.ui.open(
      "Những việc cần anh chú ý",
      "Mở đúng session để xem và phản hồi.",
      HOME.view.attention(),
    ),
  running: () =>
    HOME.ui.open(
      "Agent đang chạy",
      "Theo dõi tiến độ trong đúng Agent session.",
      `<div class="session-list">${
        HOME.state.sessions
          .filter(
            (s) => s.status === "running" && HOME.state.hosts.find((h) => h.id === s.host)?.online,
          )
          .map(HOME.view.session)
          .join("") || "<p>Chưa có Agent đang chạy.</p>"
      }</div>`,
    ),
  pin: () => {
    const session = HOME.state.sessions.find((s) => s.bot === "Product assistant");
    if (session) HOME.ui.session(session.id);
    else HOME.ui.bots();
  },
  "workspace-context": () =>
    HOME.ui.open(
      "Workspace để bắt đầu",
      "Áp dụng khi tạo Agent session mới.",
      "<p>Home dùng Workspace mặc định của Project đã chọn. Các lựa chọn nâng cao như New worktree nằm trong bước tạo Workspace riêng.</p>",
      HOME.ui.button("context", "Xem ngữ cảnh"),
    ),
  account: () =>
    HOME.ui.open(
      "Không gian của Long",
      "Cá nhân · các Host, Project và session anh có quyền truy cập.",
      "<p>Home tổng hợp công việc trên các Host đã kết nối. Các quyền quản lý Host, Project và lịch được kiểm tra trước khi hiển thị hành động.</p>",
      HOME.ui.button("hosts", "Quản lý Hosts"),
    ),
  settings: () =>
    HOME.ui.open(
      "Tùy chọn Home",
      "Giữ trải nghiệm gọn theo cách anh làm việc.",
      "<p>Bản thiết kế đang dùng lựa chọn gần nhất sau lần gửi thành công, 4 session gần đây mặc định, lịch nhóm hôm nay / ngày mai và việc cần phản hồi ở vị trí dễ thấy.</p>",
      HOME.ui.button("context", "Ngữ cảnh hiện tại") + HOME.ui.button("theme", "Đổi sáng / tối"),
    ),
  help: () =>
    HOME.ui.open(
      "Bắt đầu cùng Clisbot",
      "Một Host, một Project, một cuộc trò chuyện.",
      '<div class="step-list"><div class="step"><span class="step-number">1</span><div><strong>Kết nối Host</strong>Desktop ưu tiên máy tính này. Web tìm local khi có thể. Điện thoại kết nối remote Host.</div></div><div class="step"><span class="step-number">2</span><div><strong>Chọn cách bắt đầu</strong>Chat với Bot cho cuộc trò chuyện; Agent session cho công việc trực tiếp trong Project.</div></div><div class="step"><span class="step-number">3</span><div><strong>Tiếp tục và theo dõi</strong>Mở session gần đây, xem việc cần phản hồi và các lịch sắp chạy.</div></div></div>',
      HOME.ui.button("connect", "Kết nối Host"),
    ),
};
HOME.ui.resetScenario = (id) => {
  const state = HOME.state;
  Object.assign(state, {
    scenario: id,
    filter: "all",
    showAll: false,
    query: "",
    connected: false,
    localFound: false,
    localStarted: false,
    providerReady: false,
    projectAdded: false,
    loadingDone: false,
    files: [],
    mode: "chat",
    provider: "Claude Code",
  });
  HOME.loadScenario();
  if (id === "returning" && state.lastUsed)
    HOME.resolveContext(state.lastUsed.host, state.lastUsed.project);
  if (id === "firstmobile") state.viewport = "mobile";
  if (id === "firstdesktop" || id === "firstweb") state.viewport = "desktop";
  HOME.ui.render();
};
HOME.ui.actions.suggest = (id) => {
  const drafts = {
    plan: "Giúp tôi làm rõ ý tưởng thiết kế Home mới và lên kế hoạch thực hiện.",
    review: "Review các thay đổi mới trong Project, chỉ ra vấn đề và đề xuất cách sửa.",
    summary: "Tóm tắt những việc đang mở và đề xuất việc nên làm tiếp theo.",
  };
  if (id === "review") HOME.state.mode = "agent";
  HOME.state.draft = drafts[id];
  HOME.ui.render();
  document.querySelector("#prompt").focus();
};
HOME.ui.actions["side-project"] = (id) => {
  const host =
    HOME.state.hosts.find(
      (h) => h.id === HOME.state.selectedHost && h.online && h.projects.includes(id),
    ) || HOME.state.hosts.find((h) => h.online && h.projects.includes(id));
  if (!host) {
    HOME.ui.hosts();
    return;
  }
  HOME.state.selectedHost = host.id;
  HOME.ui.pickContext("project", id);
};
HOME.ui.actions["mobile-menu"] = () =>
  HOME.ui.open(
    "Không gian của Long",
    "Điều hướng và bắt đầu công việc.",
    `<nav>${HOME.view.nav("home", "home", "Home", true)}${HOME.view.nav("history", "chat", "Sessions")}${HOME.view.nav("search", "search", "Tìm kiếm")}${HOME.view.nav("automations", "clock", "Automations")}${HOME.view.nav("hosts", "host", "Hosts")}${HOME.view.nav("settings", "settings", "Cài đặt")}</nav><button class="modal-inline-action" data-action="add-project">+ Thêm Project</button>`,
  );
HOME.ui.actions["connect-demo"] = () => {
  const state = HOME.state;
  state.connected = true;
  if (HOME.isFirst()) HOME.loadScenario();
  let remote = state.hosts.find((h) => h.id === "remote");
  if (!remote) {
    remote = structuredClone(HOME.hosts[1]);
    state.hosts.push(remote);
  }
  remote.online = true;
  HOME.resolveContext("remote", "clisbot");
  state.notice = null;
  HOME.ui.close();
  HOME.ui.render();
  HOME.ui.toast("Đã kết nối Dev server mẫu. Chat đã sẵn sàng.");
};
HOME.ui.actions["scan-demo"] = () => {
  document.querySelector("#pairing-link").value = "Lời mời ghép nối mẫu · Dev server";
  HOME.ui.toast("QR mẫu đã được đọc. Chọn remote Host mẫu để tiếp tục.");
};
HOME.ui.actions["find-local"] = () =>
  HOME.ui.open(
    "Tìm Host local trên máy tính này",
    "Ưu tiên local khi trình duyệt có thể kết nối.",
    "<p>Web cần một Host local đang chạy và truy cập được từ trình duyệt. Nếu Host không được tìm thấy, anh có thể lấy lời mời ghép nối từ Clisbot Desktop hoặc dùng remote Host.</p>" +
      HOME.ui.demoNote,
    HOME.ui.button("local-missing", "Thử không tìm thấy") +
      HOME.ui.button("local-found", "Thử tìm thấy Host local", true),
  );
HOME.ui.actions["local-found"] = () => {
  HOME.state.localFound = true;
  HOME.loadScenario();
  HOME.ui.close();
  HOME.ui.render();
  HOME.ui.toast("Đã tìm thấy Host local mẫu và chọn Project gần nhất.");
};
HOME.ui.actions["local-missing"] = () =>
  HOME.ui.open(
    "Chưa tìm thấy Host local",
    "Anh vẫn có thể kết nối máy tính đang dùng.",
    "<p>Mở Clisbot Desktop trên máy tính, chuẩn bị Host local rồi lấy lời mời ghép nối để kết nối trên web. Nếu trình duyệt chặn kết nối local, dùng liên kết ghép nối hoặc remote Host.</p>",
    HOME.ui.button("find-local", "Tìm lại") + HOME.ui.button("connect", "Kết nối bằng lời mời"),
  );
HOME.ui.actions["local-setup"] = () =>
  HOME.ui.open(
    "Thiết lập Host local",
    "MacBook của Long · được Clisbot Desktop quản lý.",
    '<dl class="detail-grid"><dt>Provider mẫu</dt><dd>Claude Code · đã sẵn sàng</dd><dt>Project mẫu</dt><dd>Clisbot</dd><dt>Bot mẫu</dt><dd>Product assistant</dd></dl><p>Trong app, bước này sẽ hướng dẫn cài / đăng nhập provider và chọn đường dẫn Project trên máy tính.</p>' +
      HOME.ui.demoNote,
    HOME.ui.button("close-modal", "Để sau") +
      HOME.ui.button("complete-local", "Dùng cấu hình local mẫu", true),
  );
HOME.ui.actions["complete-local"] = () => {
  HOME.state.localStarted = true;
  HOME.loadScenario();
  HOME.ui.close();
  HOME.ui.render();
  HOME.ui.toast("Host local đã sẵn sàng. Anh có thể nhắn tin.");
};
HOME.ui.actions["provider-setup"] = () => {
  if (!HOME.selectedHost()?.online) {
    HOME.ui.hosts();
    return;
  }
  HOME.ui.open(
    "Chuẩn bị provider",
    "Cài và đăng nhập provider trên Host đã chọn.",
    '<p>Chọn Claude Code, Codex hoặc provider anh muốn dùng. Sau khi cài và đăng nhập trên Host, làm mới trạng thái provider để bắt đầu.</p><div class="step-list"><div class="step"><span class="step-number">1</span><div><strong>Cài provider trên Host</strong>Theo hướng dẫn của provider anh chọn.</div></div><div class="step"><span class="step-number">2</span><div><strong>Đăng nhập và kiểm tra</strong>Provider cần có thể chạy trên Host trước khi tạo session.</div></div></div>' +
      HOME.ui.demoNote,
    HOME.ui.button("provider-ready", "Mô phỏng provider sẵn sàng", true),
  );
};
HOME.ui.actions["provider-ready"] = () => {
  const host = HOME.selectedHost();
  host.ready = true;
  host.providers = ["Claude Code", "Codex"];
  HOME.state.providerReady = true;
  HOME.ui.close();
  HOME.ui.render();
  HOME.ui.toast("Provider mẫu đã sẵn sàng.");
};
HOME.ui.actions.reconnect = () => {
  const state = HOME.state;
  const local = state.hosts.find((h) => h.local);
  if (local) local.online = true;
  else if (state.hosts[0]) state.hosts[0].online = true;
  HOME.resolveContext(state.lastUsed?.host || "local", state.lastUsed?.project || "clisbot");
  HOME.ui.close();
  HOME.ui.render();
  HOME.ui.toast("Đã mô phỏng kết nối lại Host. Bản nháp được giữ.");
};
HOME.ui.actions["reconnect-session"] = (id) => {
  const session = HOME.state.sessions.find((s) => s.id === id);
  const host = HOME.state.hosts.find((h) => h.id === session.host);
  host.online = true;
  HOME.ui.render();
  HOME.ui.session(id);
  HOME.ui.toast("Đã kết nối lại đúng Host gốc trong bản demo.");
};
HOME.ui.actions["finish-loading"] = () => {
  HOME.state.loadingDone = true;
  HOME.resolveContext(
    HOME.state.lastUsed?.host || "local",
    HOME.state.lastUsed?.project || "clisbot",
  );
  HOME.ui.render();
};
HOME.ui.actions["host-detail"] = (id) => {
  const host = HOME.state.hosts.find((item) => item.id === id);
  if (!host) return;
  HOME.ui.open(
    HOME.esc(host.name),
    host.local ? "Host local" : "Remote Host",
    "<p>Host đang offline. Kiểm tra Clisbot đang chạy trên máy tính này và kết nối mạng, rồi thử kết nối lại.</p>" +
      HOME.ui.demoNote,
    HOME.ui.button("hosts", "Quay lại Hosts") +
      HOME.ui.button("reconnect-host", "Mô phỏng kết nối lại", true, id),
  );
};
HOME.ui.actions["reconnect-host"] = (id) => {
  const host = HOME.state.hosts.find((item) => item.id === id);
  if (!host) return;
  host.online = true;
  HOME.ui.render();
  HOME.ui.hosts();
  HOME.ui.toast("Host mẫu đã online. Chọn Host nếu muốn dùng cho tin nhắn mới.");
};
HOME.ui.actions["resume-session"] = (id) => {
  const text = document.querySelector("#session-message").value.trim();
  if (!text) {
    document.querySelector("#session-message").focus();
    return;
  }
  const session = HOME.state.sessions.find((s) => s.id === id);
  if (!HOME.state.hosts.find((h) => h.id === session.host)?.online) return;
  session.preview = text;
  session.time = "Vừa xong";
  session.stamp = Date.now();
  HOME.ui.render();
  HOME.ui.session(id);
  HOME.ui.toast("Đã thêm tin nhắn minh họa vào đúng session.");
};
HOME.ui.actions["review-proposal"] = (id) =>
  HOME.ui.open(
    "Đề xuất của agent",
    "Review thay đổi channel · Dev server · Claude Code",
    "<p>Đề xuất minh họa: thêm giới hạn thời gian cho retry, ghi nhận lỗi và cho phép thử lại trong đúng session. Agent đang chờ phản hồi của anh về phạm vi thay đổi.</p><p>Trong app, màn hình này mở nội dung và thay đổi thực tế của session để anh xem trước khi phản hồi.</p>" +
      HOME.ui.demoNote,
    HOME.ui.button("session", "Quay lại session", false, id),
  );
HOME.ui.actions["pause-schedule"] = (id) => {
  const schedule = HOME.state.schedules.find((s) => s.id === id);
  schedule.paused = !schedule.paused;
  HOME.ui.render();
  HOME.ui.schedule(id);
};
HOME.ui.actions.attach = () =>
  HOME.ui.open(
    "Đính kèm vào tin nhắn",
    "Tài liệu giúp Bot hoặc agent hiểu việc anh cần.",
    '<label class="form-label" for="attachment">Chọn tệp</label><input id="attachment" type="file" multiple class="form-input" /><p>Prototype chỉ hiện tên tệp đã chọn. Nội dung tệp không được đọc hay gửi đi.</p>' +
      HOME.ui.demoNote,
  );
HOME.ui.actions["remove-file"] = (id) => {
  HOME.state.files.splice(Number(id), 1);
  HOME.ui.render();
};
HOME.ui.actions.voice = () =>
  HOME.ui.open(
    "Nhập bằng giọng nói",
    "Nói ý tưởng và kiểm tra nội dung trước khi gửi.",
    "<p>Trong app, lời nói sẽ được chuyển thành bản nháp trong composer. Anh luôn có thể sửa lại trước khi gửi.</p>" +
      HOME.ui.demoNote,
    HOME.ui.button("voice-demo", "Thử bản ghi mẫu"),
  );
HOME.ui.actions["voice-demo"] = () => {
  HOME.state.draft = "Giúp tôi tổng hợp tiến độ hôm nay và lên kế hoạch cho ngày mai.";
  HOME.ui.close();
  HOME.ui.render();
  document.querySelector("#prompt").focus();
};
document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  if (button.dataset.concept) {
    HOME.state.concept = button.dataset.concept;
    history.replaceState(null, "", `#${HOME.state.concept}`);
    HOME.ui.render();
    return;
  }
  const action = HOME.ui.actions[button.dataset.action];
  if (action) action(button.dataset.id);
});
document.addEventListener("input", (event) => {
  const target = event.target;
  if (target.id === "prompt") {
    HOME.state.draft = target.value;
    document.querySelector("#send").disabled = !HOME.canSend() || !target.value.trim();
    HOME.ui.save();
  }
  if (target.id === "session-search") {
    HOME.state.query = target.value;
    document.querySelector("#search-results").innerHTML =
      HOME.view.filteredSessions().map(HOME.view.session).join("") ||
      "<p>Chưa có session phù hợp.</p>";
  }
});
document.addEventListener("change", (event) => {
  if (event.target.id === "scenario") HOME.ui.resetScenario(event.target.value);
  if (event.target.id === "attachment") {
    HOME.state.files.push(...Array.from(event.target.files).map((file) => file.name));
    HOME.ui.close();
    HOME.ui.render();
  }
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    HOME.ui.search();
  }
  if (
    event.target.id === "prompt" &&
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing
  ) {
    event.preventDefault();
    HOME.ui.send();
  }
});
document.querySelector("#modal").addEventListener("click", (event) => {
  if (event.target === event.currentTarget && event.clientX) {
    const r = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      HOME.ui.close();
  }
});
document.querySelector("#modal").addEventListener("cancel", () =>
  setTimeout(() => {
    document.querySelector("#prompt")?.focus({ preventScroll: true });
  }, 0),
);
try {
  const saved = JSON.parse(sessionStorage.getItem("clisbot-home-design-v1") || "{}");
  Object.assign(HOME.state, {
    concept: HOME.concepts[saved.concept] ? saved.concept : "fusion",
    theme: saved.theme === "dark" ? "dark" : "light",
    viewport: saved.viewport === "mobile" ? "mobile" : "desktop",
    draft: saved.draft || "",
    lastUsed: saved.lastUsed || null,
  });
} catch {
  /* Openable with storage disabled. */
}
if (HOME.concepts[location.hash.slice(1)]) HOME.state.concept = location.hash.slice(1);
document.querySelector("#scenario").innerHTML = Object.entries(HOME.scenarios)
  .map(([id, [label]]) => `<option value="${id}">${label}</option>`)
  .join("");
HOME.loadScenario();
if (HOME.state.lastUsed) HOME.resolveContext(HOME.state.lastUsed.host, HOME.state.lastUsed.project);
HOME.ui.render();
