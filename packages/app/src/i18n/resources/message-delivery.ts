const en = {
  sending: "Sending...",
  waitingForHost: "Not sent: waiting for the Host",
  notSent: "Not sent: {{reason}}",
  retry: "Retry",
  delete: "Delete",
  hostUnreachable: "Host unreachable",
};

const vi: typeof en = {
  sending: "Đang gửi...",
  waitingForHost: "Chưa gửi: đang chờ Host",
  notSent: "Chưa gửi: {{reason}}",
  retry: "Gửi lại",
  delete: "Xóa",
  hostUnreachable: "Không kết nối được Host",
};

/** Unsent message states (instant send); languages other than Vietnamese use English. */
export const messageDelivery = {
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
