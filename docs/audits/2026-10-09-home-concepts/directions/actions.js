HOME.ui.actions["direction-detail"] = () => {
  const d = HOME.directions[HOME.direction];
  const synthesis =
    HOME.direction === 4
      ? `<div class="synthesis-notes"><h3>Vì sao bản 4 hiệu quả hơn việc ghép cả ba?</h3><p>Chat, kết nối và tiếp tục công việc có ba vùng rõ ràng. Composer luôn hiện; Host có vùng riêng để giải thích trạng thái. Lần đầu, vùng Host mở hướng dẫn; khi đã sẵn sàng, nó thu gọn thành ngữ cảnh kiểm tra được.</p><p>Chỉ một việc cần phản hồi được đưa cạnh chat. Mọi session và lịch còn lại ở phía dưới, với bộ lọc Project độc lập để không làm thay đổi nơi gửi tin nhắn mới.</p><p>Local sẵn sàng: nhắn ngay. Web chưa có local: hướng dẫn bật Host rồi thử lại. Mobile: hướng dẫn ghép nối remote. Fallback chỉ đổi nơi bắt đầu mới; session và lịch giữ Host gốc.</p></div>`
      : "";
  HOME.ui.open(
    `0${HOME.direction} · ${d.name}`,
    "Đề xuất Home, giữ UI và thuật ngữ của Clisbot hiện tại.",
    `<dl class="detail-grid"><dt>Thế mạnh</dt><dd>${d.strength}</dd><dt>Đánh đổi</dt><dd>${d.tradeoff}</dd><dt>Ngữ cảnh mới</dt><dd>Host / Project gần nhất → local sẵn sàng → Host khả dụng. Chỉ nhớ lựa chọn sau lần gửi thành công.</dd><dt>Lần đầu</dt><dd>Desktop / Web ưu tiên local. Mobile hướng dẫn remote. Draft được giữ trong khi kết nối.</dd></dl>${synthesis}${HOME.ui.demoNote}`,
    HOME.ui.button("host-guide", "Xem luồng Host") + HOME.ui.button("close-modal", "Đóng"),
  );
};
HOME.ui.actions["activity-scope"] = () => {
  HOME.state.activityScope = HOME.state.activityScope === "project" ? "all" : "project";
  HOME.state.showAll = false;
  HOME.ui.render();
};
HOME.ui.resetScenario = (id) => {
  HOME.state.activityScope = "all";
  HOME.state.contextChanged = false;
  HOME.directionBase.reset(id);
};
const directionPickContext = HOME.ui.pickContext;
HOME.ui.pickContext = (kind, id) => {
  if (kind === "host" || kind === "project") HOME.state.contextChanged = true;
  directionPickContext(kind, id);
};
HOME.ui.actions["choose-bot"] = (id) => {
  HOME.state.contextChanged = true;
  HOME.ui.chooseBot(id);
};
HOME.ui.render = () => {
  HOME.state.concept = HOME.directions[HOME.direction].concept;
  HOME.directionBase.render();
  document.querySelector("#app").classList.remove("rail");
  document.querySelectorAll("[data-direction-link]").forEach((a) => {
    const selected = Number(a.dataset.directionLink) === HOME.direction;
    a.classList.toggle("active", selected);
    if (selected) a.setAttribute("aria-current", "page");
  });
};
HOME.ui.render();
