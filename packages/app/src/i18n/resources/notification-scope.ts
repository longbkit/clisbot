const en = {
  title: "Notifications",
  label: "Notify me about",
  off: "Off",
  descriptions: {
    mine: "Sessions you started or joined, as in For me. Teammates' sessions stay quiet.",
    others: "Only teammates' sessions, as in Others.",
    all: "Every session you can open, including teammates'.",
    off: "No session notifications from any Host.",
  },
  hostNote:
    "Applies to every Host on this device. A Host that has not been updated still notifies you about every session.",
};

const vi: typeof en = {
  title: "Thông báo",
  label: "Thông báo cho",
  off: "Tắt",
  descriptions: {
    mine: "Session bạn tạo hoặc tham gia, giống mục Của tôi. Session của đồng đội không báo.",
    others: "Chỉ session của đồng đội, giống mục Người khác.",
    all: "Mọi session bạn mở được, kể cả của đồng đội.",
    off: "Không nhận thông báo session từ Host nào.",
  },
  hostNote:
    "Áp dụng cho mọi Host trên thiết bị này. Host chưa cập nhật vẫn báo cho bạn mọi session.",
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
