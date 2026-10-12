/* All interactions remain in this standalone browser fixture. */
HOME.ui.save = () => {
  try {
    sessionStorage.setItem(
      "clisbot-home-combined-v2",
      JSON.stringify({
        theme: HOME.state.theme,
        viewport: HOME.state.viewport,
        draft: HOME.state.draft,
        lastUsed: HOME.state.lastUsed,
        launchpad: HOME.state.launchpad,
        lastProjects: HOME.state.lastProjects,
      }),
    );
  } catch {
    /* File URLs may disable storage. */
  }
};
HOME.ui.hostGuide = () =>
  HOME.ui.open(
    "Host: bắt đầu nhanh, biết rõ nơi chạy",
    "Desktop / Web ưu tiên local. Mobile kết nối máy tính từ xa.",
    `<div class="step-list"><div class="step"><span class="step-number">1</span><div><strong>Đã dùng trước đó</strong>Dùng Host và Project của lần gửi thành công gần nhất nếu còn online và còn quyền. Nếu thiếu, chọn ngữ cảnh khả dụng, báo rõ thay đổi và giữ draft.</div></div><div class="step"><span class="step-number">2</span><div><strong>Lần đầu trên Desktop</strong>App tự khởi động Host local do Desktop quản lý. Khi provider sẵn sàng, người dùng gửi ngay; trợ lý cá nhân và Project riêng được tạo khi gửi. Có thể đổi sang remote.</div></div><div class="step"><span class="step-number">3</span><div><strong>Lần đầu trên Web</strong>Tự kiểm tra local có thể truy cập từ trình duyệt. Chưa tìm thấy: mở Desktop hoặc chạy <code>clisbot daemon start</code>, tìm lại, hoặc ghép nối remote. Trình duyệt chặn: chỉ rõ quyền mạng local, không lặp spinner vô hạn.</div></div><div class="step"><span class="step-number">4</span><div><strong>Lần đầu trên Mobile</strong>Mở Clisbot Desktop trên máy tính, vào Hosts → Pair device. Quét QR hoặc dán lời mời còn hạn. Điện thoại kết nối remote Host.</div></div></div><p>Chat dùng cấu hình của Bot. Agent session mới dùng Workspace của Project đã chọn. Session và lịch đang có luôn giữ Host gốc; fallback Home chỉ dành cho lần bắt đầu mới.</p><p>Trợ lý cá nhân tự tạo là đề xuất mới của bản thiết kế, chưa phải hành vi đang có trong app.</p>${HOME.ui.demoNote}`,
    HOME.ui.button("hosts", "Xem Hosts") + HOME.ui.button("connect", "Kết nối remote Host"),
  );
HOME.ui.hosts = () => {
  const state = HOME.state;
  const rows = state.hosts
    .map(
      (host) =>
        `<button class="picker-row ${state.selectedHost === host.id ? "selected" : ""}" data-action="${host.online ? "pick-host" : "host-detail"}" data-id="${host.id}">${HOME.icon(host.local ? "host" : "remote")}<span class="picker-copy"><span class="picker-title">${host.local ? "Local · Máy này" : HOME.esc(host.name)}</span><small>${HOME.esc(host.name)} · ${host.online ? "Online" : "Offline"}${!host.ready ? " · Provider chưa sẵn sàng" : ""}</small></span>${state.selectedHost === host.id ? HOME.icon("check") : ""}</button>`,
    )
    .join("");
  const localHelp =
    state.viewport !== "mobile" && !state.hosts.some((h) => h.local)
      ? '<button class="modal-inline-action" data-action="local-help">Bắt đầu với Host local trên máy này →</button>'
      : "";
  HOME.ui.open(
    "Hosts",
    "Máy tính sẽ chạy Chat / Agent session mới. Local là máy đang mở Desktop hoặc Web.",
    `${rows || "<p>Chưa có Host được kết nối.</p>"}${localHelp}<button class="modal-inline-action" data-action="connect">+ Thêm remote Host</button><p>Home nhớ lựa chọn sau khi gửi thành công. Session đang có luôn mở trên Host gốc.</p>`,
  );
};
HOME.ui.localHelp = () =>
  HOME.ui.open(
    "Kết nối Host local",
    "Bắt đầu trên máy tính đang dùng Desktop hoặc Web.",
    '<div class="step-list"><div class="step"><span class="step-number">1</span><div><strong>Desktop tự quản lý Host local</strong>Mở Clisbot Desktop và đợi Host khởi động. Không cần thêm lại local như một remote Host.</div></div><div class="step"><span class="step-number">2</span><div><strong>Web cần Host local đang chạy</strong>Mở Desktop, hoặc nếu đã cài CLI, chạy <code>clisbot daemon start</code> trên máy tính này.</div></div><div class="step"><span class="step-number">3</span><div><strong>Cho phép truy cập rồi tìm lại</strong>Nếu trình duyệt hỏi quyền mạng local, cho phép kết nối. Nếu vẫn bị chặn, dùng lời mời ghép nối hoặc remote Host.</div></div></div>' +
      HOME.ui.demoNote,
    HOME.ui.button("retry-local", "Tìm lại local") +
      HOME.ui.button("connect", "Kết nối remote Host"),
  );
HOME.ui.connect = () => {
  const state = HOME.state;
  const method = state.pairingMethod || "link";
  const mobile = state.viewport === "mobile";
  const methods = [
    ["qr", "QR", "scan-demo"],
    ["link", "Liên kết", "pair-method"],
    ["direct", "Địa chỉ", "pair-method"],
    ["ssh", "SSH", "pair-method"],
  ];
  const methodsHtml = methods
    .map(
      ([id, label, action]) =>
        `<button class="${method === id ? "primary-button" : "outline-button"}" data-action="${action}" data-id="${id}">${label}</button>`,
    )
    .join("");
  const form =
    method === "ssh"
      ? '<label class="form-label" for="pairing-link">Địa chỉ SSH của Host</label><input class="form-input" id="pairing-link" placeholder="user@dev-machine" value="' +
        HOME.esc(state.pairingLink || "") +
        '" /><p>Trong app, dùng kết nối SSH hiện có và bước xác thực của Host.</p>'
      : `<label class="form-label" for="pairing-link">${method === "direct" ? "Địa chỉ Host" : "Liên kết ghép nối"}</label><input class="form-input" id="pairing-link" placeholder="${method === "direct" ? "Địa chỉ Host có thể truy cập từ thiết bị này" : "Dán liên kết từ máy tính của anh"}" value="${HOME.esc(state.pairingLink || "")}" autocomplete="off" />`;
  const errors = {
    expired: [
      "Lời mời đã hết hạn",
      "Mở Pair device trên máy tính để lấy QR hoặc liên kết mới. Dữ liệu đang nhập vẫn được giữ.",
    ],
    network: [
      "Chưa kết nối được Host",
      "Kiểm tra Host đang chạy và kết nối mạng của hai thiết bị, rồi thử lại. Dữ liệu đang nhập vẫn được giữ.",
    ],
  };
  const issue = errors[state.pairingIssue];
  HOME.ui.open(
    mobile ? "Kết nối máy tính của anh" : "Thêm remote Host",
    "Agent và code chạy trên Host anh kết nối.",
    `<div class="step-list"><div class="step"><span class="step-number">1</span><div><strong>Mở Clisbot Desktop trên máy tính</strong>Vào Hosts, chọn máy tính, rồi chọn Pair device.</div></div><div class="step"><span class="step-number">2</span><div><strong>Kết nối trên thiết bị này</strong>${mobile ? "Quét QR hoặc dán liên kết ghép nối." : "Dán liên kết ghép nối, hoặc dùng phương thức đang có."}</div></div></div><div class="pairing-methods">${methodsHtml}</div>${form}${issue ? `<div class="pairing-error" role="alert"><strong>${issue[0]}</strong>${issue[1]}</div>` : ""}<div class="connection-actions"><button class="text-action" data-action="pair-error" data-id="expired">Thử QR hết hạn</button><button class="text-action" data-action="pair-error" data-id="network">Thử lỗi mạng</button></div>${HOME.ui.demoNote}`,
    HOME.ui.button("close-modal", "Để sau") +
      HOME.ui.button("connect-demo", issue ? "Thử kết nối lại" : "Kết nối", true),
  );
};
HOME.ui.chooseBot = (key) => {
  const bot = HOME.bots.find(
    (b) =>
      HOME.botKey(b) === key &&
      HOME.state.hosts.some((h) => h.id === b.host && h.online && h.projects.includes(b.project)),
  );
  if (!bot) {
    HOME.ui.hosts();
    return;
  }
  Object.assign(HOME.state, {
    selectedBotName: bot.name,
    selectedHost: bot.host,
    selectedProject: bot.project,
    mode: "chat",
    focusedStarter: "",
  });
  HOME.ui.close();
  HOME.ui.render();
  HOME.ui.toast("Đã chọn đúng Host và Project của Bot. Bản nháp được giữ.");
};
HOME.ui.bots = () => {
  const bots = HOME.bots.filter((b) =>
    HOME.state.hosts.some((h) => h.id === b.host && h.projects.includes(b.project)),
  );
  const rows = bots
    .map(
      (b) =>
        `<button class="picker-row" data-action="choose-bot" data-id="${HOME.esc(HOME.botKey(b))}" ${HOME.state.hosts.find((h) => h.id === b.host)?.online ? "" : "disabled"}><span class="avatar">${HOME.esc(b.avatar)}</span><span class="picker-copy"><span class="picker-title">${HOME.esc(b.name)}</span><small>${HOME.esc(HOME.projects[b.project].name)} · ${HOME.esc(HOME.state.hosts.find((h) => h.id === b.host).name)} · ${b.provider}</small></span></button>`,
    )
    .join("");
  const pending = HOME.pendingAssistant()
    ? '<div class="picker-row"><span class="avatar">PA</span><span class="picker-copy"><span class="picker-title">Trợ lý cá nhân · tạo khi gửi</span><small>Local · Project riêng · quyền mặc định</small></span></div>'
    : "";
  HOME.ui.open(
    "Chat với Bot",
    "Bot giữ Host, Project, provider và quyền của mình.",
    pending +
      (rows || (pending ? "" : "<p>Chưa có Bot trong ngữ cảnh này.</p>")) +
      '<button class="modal-inline-action" data-action="new-bot">+ Tạo Bot</button>',
  );
};
HOME.ui.launchpad = () => {
  const rows = Object.entries(HOME.starters)
    .map(([id, s]) => {
      const index = HOME.state.launchpad.indexOf(id);
      return `<div class="launchpad-row"><span class="starter-icon ${id}">${HOME.icon(s.icon)}</span><span class="picker-copy"><span class="picker-title">${s.title}</span><small>${s.subtitle}</small></span>${index >= 0 ? `<button class="icon-button" data-action="move-starter" data-id="${id}:up" aria-label="Đưa ${s.title} lên" ${index === 0 ? "disabled" : ""}>${HOME.icon("arrow")}</button><button class="icon-button" data-action="move-starter" data-id="${id}:down" aria-label="Đưa ${s.title} xuống" ${index === HOME.state.launchpad.length - 1 ? "disabled" : ""}>${HOME.icon("down")}</button><button class="outline-button" data-action="unpin-starter" data-id="${id}">Bỏ ghim</button>` : `<button class="outline-button" data-action="pin-starter" data-id="${id}">Ghim</button>`}</div>`;
    })
    .join("");
  HOME.ui.open(
    "Gợi ý trên Home",
    "Ghim tối đa 5 gợi ý, đổi thứ tự hoặc bỏ ghim. Chọn một thẻ để sửa lời nhắn trước khi gửi.",
    rows,
    HOME.ui.button("reset-launchpad", "Đặt lại mặc định") + HOME.ui.button("close-modal", "Xong"),
  );
};
HOME.ui.applyStarter = (id, append = false) => {
  const starter = HOME.starters[id];
  Object.assign(HOME.state, {
    draft:
      append && HOME.state.draft.trim()
        ? HOME.state.draft + "\n\n" + starter.prompt
        : starter.prompt,
    mode: starter.mode,
    focusedStarter: id,
  });
  HOME.ui.close();
  HOME.ui.render();
  document.querySelector("#prompt").focus({ preventScroll: true });
};
HOME.ui.config = (kind) => {
  const bot = HOME.selectedBot();
  const label = { model: "Model", permission: "Permissions", thinking: "Thinking" }[kind];
  const pending = bot?.pending;
  const copy = {
    permission:
      "Default permissions dùng hồ sơ quyền mặc định của provider. Không tự nâng lên Full access khi dùng thẻ gợi ý hay khi fallback.",
    model:
      "Chọn model từ danh sách provider trên Host. Bản mẫu dùng model mặc định của provider, không giả định một model có sẵn.",
    thinking: "Dùng mức thinking mặc định của cấu hình đang chọn.",
  }[kind];
  HOME.ui.open(
    label,
    `${HOME.state.mode === "chat" ? bot?.name || "Chọn Bot" : HOME.state.provider} · ${HOME.selectedHost()?.name || "Chưa chọn Host"}`,
    `<dl class="detail-grid"><dt>Provider</dt><dd>${HOME.state.mode === "chat" ? bot?.provider || "Chưa chọn" : HOME.state.provider}</dd><dt>Model</dt><dd>Mặc định của provider trên Host</dd><dt>Permissions</dt><dd>Default permissions</dd><dt>Thinking</dt><dd>Mặc định của cấu hình</dd></dl><p>${copy}</p>${HOME.state.mode === "chat" && !pending ? "<p>Chat dùng cấu hình đã lưu của Bot. Mở cấu hình Bot để thay đổi; thay đổi provider cho Agent session mới không sửa Bot này.</p>" : "<p>Kiểm tra cấu hình trước khi gửi. Thao tác với tệp vẫn đi qua cơ chế yêu cầu quyền của provider.</p>"}`,
    HOME.ui.button(
      HOME.state.mode === "chat" ? "bots" : "providers",
      HOME.state.mode === "chat" ? "Chọn Bot khác" : "Chọn provider",
    ) + HOME.ui.button("close-modal", "Xong"),
  );
};
HOME.ui.menu = (title, rows) =>
  HOME.ui.open(
    title,
    "Các hành động đang có trong Clisbot.",
    rows
      .map(
        ([action, icon, label]) =>
          `<button class="picker-row" data-action="${action}">${HOME.icon(icon)}<span>${label}</span></button>`,
      )
      .join(""),
  );
HOME.ui.context = () => {
  const host = HOME.selectedHost();
  const bot = HOME.selectedBot();
  const project = HOME.projects[HOME.state.selectedProject];
  const pending = bot?.pending;
  HOME.ui.open(
    "Ngữ cảnh của tin nhắn mới",
    "Kiểm tra nơi chạy trước khi gửi.",
    `<dl class="detail-grid"><dt>Host</dt><dd>${HOME.esc(host?.name || "Chưa kết nối")}${host?.local ? " · Local / máy này" : ""}</dd><dt>Project</dt><dd>${HOME.esc(project?.name || (pending ? "Project riêng của trợ lý · tạo khi gửi" : "Chưa chọn"))}</dd><dt>Cách bắt đầu</dt><dd>${HOME.state.mode === "chat" ? "Chat mới với Bot" : "Agent session mới"}</dd><dt>Bot / Workspace</dt><dd>${HOME.state.mode === "chat" ? HOME.esc(bot?.name || "Chưa chọn Bot") : "Workspace mặc định của Project"}${pending ? " · tạo khi gửi" : ""}</dd><dt>Provider</dt><dd>${HOME.esc(HOME.state.mode === "chat" ? bot?.provider || HOME.state.provider : HOME.state.provider)}</dd><dt>Model</dt><dd>Mặc định của provider</dd><dt>Permissions</dt><dd>Default permissions</dd><dt>Trạng thái</dt><dd>${HOME.canSend() ? "Sẵn sàng gửi" : "Cần hoàn tất kết nối / thiết lập"}</dd></dl><p>Chỉ nhớ Host và Project sau lần gửi thành công. Khi ngữ cảnh cũ không khả dụng, Home báo rõ lựa chọn thay thế. Session và lịch đã có luôn giữ Host gốc.</p>`,
    HOME.ui.button("hosts", "Đổi Host") + HOME.ui.button("projects", "Đổi Project"),
  );
};
const combinedPickContext = HOME.ui.pickContext;
HOME.ui.pickContext = (kind, id) => {
  if (kind !== "host") {
    combinedPickContext(kind, id);
    return;
  }
  const state = HOME.state;
  const host = state.hosts.find((h) => h.id === id && h.online);
  if (!host) return;
  const projects = HOME.availableProjects(host);
  let project = state.lastProjects[id];
  if (state.selectedHost === id && projects.includes(state.selectedProject))
    project = state.selectedProject;
  state.selectedHost = id;
  state.selectedProject = projects.includes(project) ? project : projects[0] || null;
  state.selectedBotName = null;
  if (!host.providers.includes(state.provider)) state.provider = host.providers[0] || "Claude Code";
  state.dismissed = true;
  if (state.mode === "chat" && !HOME.selectedBot()) state.mode = "agent";
  HOME.ui.close();
  HOME.ui.render();
  HOME.ui.toast("Đã chọn Host và Project khả dụng trên Host này. Bản nháp được giữ.");
};
Object.assign(HOME.ui.actions, {
  hosts: HOME.ui.hosts,
  bots: HOME.ui.bots,
  connect: HOME.ui.connect,
  context: HOME.ui.context,
  "host-guide": HOME.ui.hostGuide,
  "local-help": HOME.ui.localHelp,
  "choose-bot": HOME.ui.chooseBot,
  launchpad: HOME.ui.launchpad,
  model: () => HOME.ui.config("model"),
  permission: () => HOME.ui.config("permission"),
  thinking: () => HOME.ui.config("thinking"),
  "mode-chat": () => {
    if (HOME.state.mode === "chat") HOME.ui.bots();
    else {
      HOME.state.mode = "chat";
      HOME.state.focusedStarter = "";
      HOME.ui.render();
    }
  },
  "choose-provider": (id) => {
    const host = HOME.selectedHost();
    if (!host?.online) {
      HOME.ui.hosts();
      return;
    }
    if (!host.ready) {
      HOME.ui.actions["provider-setup"]();
      return;
    }
    HOME.state.mode = "agent";
    HOME.ui.pickContext("provider", id);
  },
  "pick-provider": (id) => {
    HOME.state.mode = "agent";
    HOME.ui.pickContext("provider", id);
  },
  "retry-local": () => {
    HOME.ui.close();
    HOME.ui.resetScenario("firstweb");
  },
  "local-started": () => {
    HOME.state.localBootDone = true;
    HOME.prepareLocal();
    HOME.ui.render();
  },
  "pair-method": (id) => {
    HOME.state.pairingMethod = id;
    HOME.state.pairingIssue = "";
    HOME.ui.connect();
  },
  "scan-demo": () => {
    HOME.state.pairingMethod = "link";
    HOME.state.pairingLink = "Lời mời ghép nối mẫu · Dev server";
    HOME.state.pairingIssue = "";
    HOME.ui.connect();
    HOME.ui.toast("QR mẫu đã được đọc. Kiểm tra và kết nối.");
  },
  "pair-error": (id) => {
    HOME.state.pairingIssue = id;
    HOME.ui.connect();
  },
  starter: (id) => {
    if (HOME.state.draft.trim())
      HOME.ui.open(
        "Đưa gợi ý vào bản nháp",
        "Bản nháp đang có được giữ cho đến khi anh chọn.",
        `<p>${HOME.starters[id].prompt}</p>`,
        HOME.ui.button("append-starter", "Thêm vào bản nháp", true, id) +
          HOME.ui.button("replace-starter", "Thay bản nháp", false, id),
      );
    else HOME.ui.applyStarter(id);
  },
  "append-starter": (id) => HOME.ui.applyStarter(id, true),
  "replace-starter": (id) => HOME.ui.applyStarter(id),
  "exit-starter": () => {
    HOME.state.focusedStarter = "";
    HOME.ui.render();
  },
  category: (id) => {
    HOME.state.category = HOME.state.category === id ? "" : id;
    HOME.ui.render();
  },
  "pin-starter": (id) => {
    if (HOME.state.launchpad.length >= 5) {
      HOME.ui.toast("Ghim tối đa 5 gợi ý. Bỏ một gợi ý để thêm.");
      return;
    }
    HOME.state.launchpad.push(id);
    HOME.ui.render();
    HOME.ui.launchpad();
  },
  "unpin-starter": (id) => {
    HOME.state.launchpad = HOME.state.launchpad.filter((key) => key !== id);
    HOME.ui.render();
    if (document.querySelector("#modal").open) HOME.ui.launchpad();
  },
  "move-starter": (value) => {
    const [id, direction] = value.split(":");
    const list = HOME.state.launchpad;
    const from = list.indexOf(id);
    const to = from + (direction === "up" ? -1 : 1);
    if (to < 0 || to >= list.length) return;
    [list[from], list[to]] = [list[to], list[from]];
    HOME.ui.render();
    HOME.ui.launchpad();
  },
  "reset-launchpad": () => {
    HOME.state.launchpad = ["cowork", "write", "research", "review"];
    HOME.ui.render();
    HOME.ui.launchpad();
  },
  "compose-menu": () =>
    HOME.ui.menu("Thêm vào tin nhắn", [
      ["attach", "attach", "Đính kèm tệp"],
      ["projects", "project", "Chọn Project"],
      ["new-schedule", "clock", "Tạo Schedule"],
      ["context", "settings", "Kiểm tra ngữ cảnh"],
    ]),
  "new-menu": () =>
    HOME.ui.menu("New", [
      ["new-bot", "chat", "Tạo Bot"],
      ["new-workspace", "terminal", "New workspace"],
      ["add-project", "project", "Thêm Project"],
      ["connect", "host", "Thêm remote Host"],
      ["new-schedule", "clock", "Tạo lịch"],
    ]),
  "new-workspace": () => {
    HOME.state.mode = "agent";
    HOME.ui.render();
    if (!HOME.state.selectedProject) HOME.ui.projects();
    else HOME.ui.actions["workspace-context"]();
  },
  "sidebar-more": () =>
    HOME.ui.menu("Điều hướng", [
      ["home", "home", "Home"],
      ["hosts", "host", "Hosts"],
      ["settings", "settings", "Settings"],
      ["host-guide", "help", "Hướng dẫn bắt đầu"],
    ]),
  connectors: () =>
    HOME.ui.open(
      "Connectors",
      "Các tài khoản và công cụ đã kết nối.",
      "<p>Lối vào Connectors hiện có được giữ trong sidebar. Chọn tài khoản và công cụ trong màn hình Connectors của app.</p>" +
        HOME.ui.demoNote,
    ),
  usage: () =>
    HOME.ui.open(
      "Usage",
      "Theo provider trên Host.",
      "<p>Lối vào Usage hiện có được giữ ở cuối sidebar. Số liệu sử dụng thực tế do provider cung cấp.</p>" +
        HOME.ui.demoNote,
    ),
});
const combinedConnect = HOME.ui.actions["connect-demo"];
HOME.ui.actions["connect-demo"] = () => {
  HOME.state.pairingIssue = "";
  clearTimeout(HOME.combined.webTimer);
  HOME.state.webChecking = false;
  combinedConnect();
};
HOME.ui.actions["mobile-menu"] = () =>
  HOME.ui.menu("Clisbot", [
    ["home", "home", "Home"],
    ["new-workspace", "plus", "New workspace"],
    ["history", "clock", "History"],
    ["automations", "bolt", "Automations"],
    ["connectors", "link", "Connectors"],
    ["hosts", "host", "Hosts"],
    ["settings", "settings", "Settings"],
  ]);
document.addEventListener("input", (event) => {
  if (event.target.id === "pairing-link") HOME.state.pairingLink = event.target.value;
});
HOME.state.concept = "fusion";
HOME.state.draft = "";
HOME.state.lastUsed = null;
try {
  const saved = JSON.parse(sessionStorage.getItem("clisbot-home-combined-v2") || "{}");
  HOME.state.theme = saved.theme === "dark" ? "dark" : "light";
  HOME.state.viewport = saved.viewport === "mobile" ? "mobile" : "desktop";
  HOME.state.draft = saved.draft || "";
  HOME.state.lastUsed = saved.lastUsed || null;
  HOME.state.lastProjects = saved.lastProjects || {};
  if (Array.isArray(saved.launchpad))
    HOME.state.launchpad = [...new Set(saved.launchpad.filter((id) => HOME.starters[id]))].slice(
      0,
      5,
    );
} catch {
  /* Review works without storage. */
}
document.querySelector("#scenario").innerHTML = Object.entries(HOME.scenarios)
  .map(([id, [label]]) => `<option value="${id}">${label}</option>`)
  .join("");
HOME.ui.resetScenario(
  HOME.scenarios[location.hash.slice(1)] ? location.hash.slice(1) : "returning",
);
if (HOME.state.scenario === "returning" && HOME.state.lastUsed) {
  const last = HOME.state.lastUsed;
  HOME.state.selectedBotName = last.bot || null;
  if (HOME.selectedHost()?.providers.includes(last.provider)) HOME.state.provider = last.provider;
  HOME.ui.render();
}
