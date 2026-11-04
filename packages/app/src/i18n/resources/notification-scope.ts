const en = {
  title: "Notifications",
  label: "Notify me about",
  off: "Off",
  follow: "Follow",
  unfollow: "Unfollow",
  followFailed: "Could not change the follow. Check that the Host is updated and connected.",
  descriptions: {
    mine: "Sessions you started, joined or follow, as in For me.",
    needs: "Only requests and failures in your sessions, as in Needs me.",
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
  follow: "Theo dõi",
  unfollow: "Bỏ theo dõi",
  followFailed: "Không đổi được theo dõi. Kiểm tra Host đã cập nhật và đang kết nối.",
  descriptions: {
    mine: "Session bạn tạo, tham gia hoặc theo dõi, như mục Của tôi.",
    needs: "Chỉ yêu cầu phê duyệt và lỗi trong session của bạn, như mục Cần tôi.",
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
