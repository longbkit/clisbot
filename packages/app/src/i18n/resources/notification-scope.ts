const en = {
  title: "Notifications",
  label: "Notify me about",
  off: "Off",
  descriptions: {
    mine: "Sessions you started or joined, as in For me.",
    others: "Only teammates' sessions, as in Others.",
    all: "Every session you can open, including teammates'.",
    off: "No session notifications from any Host.",
  },
  hostNote: "Hosts not yet updated still notify about every session.",
};

const vi: typeof en = {
  title: "Thông báo",
  label: "Thông báo cho",
  off: "Tắt",
  descriptions: {
    mine: "Session bạn tạo hoặc tham gia, như mục Của tôi.",
    others: "Chỉ session của đồng đội, giống mục Người khác.",
    all: "Mọi session bạn mở được, kể cả của đồng đội.",
    off: "Không nhận thông báo session từ Host nào.",
  },
  hostNote: "Host chưa cập nhật vẫn báo mọi session.",
};

/** Which sessions may notify the reader; languages other than Vietnamese use English. */
export const notificationScope = {
  en,
  ar: en,
  es: en,
  fr: en,
  ja: en,
  ko: en,
  "pt-BR": en,
  ru: en,
  vi,
  "zh-CN": en,
};
