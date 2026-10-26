/**
 * Offline O1 copy (docs/features/offline/connection-resilience.md): per-source status and Hub
 * failures. A separate `offline` namespace so these keys merge without touching the shared
 * per-locale resource files; locales other than en and vi fall back to en.
 */
const en = {
  theHub: "The Hub",
  source: {
    hubUnreachable:
      "{{source}}: {{hub}} is unreachable. If it is reached over a VPN, check that connection.",
    hubSignIn: "{{source}}: sign in to {{hub}} again.",
    revoked: "{{source}}: access was removed.",
    hostSignIn: "{{source}}: enter the Host password again.",
    hostUnreachable: "{{source}}: {{error}}",
    disconnected: "Disconnected. Reconnect to refresh conversations.",
    directoryFailed: "Could not load the list",
  },
  hub: {
    unreachable: "{{hub}} is unreachable. If it is reached over a VPN, check that connection.",
    needsSignIn: "Sign in to {{hub}} again.",
    revoked: "Your access to {{hub}} was removed.",
    timedOut: "The Hub did not answer within {{seconds}} s",
    partial: "{{hub}}: {{reachable}}/{{total}} reachable",
  },
  notice: {
    more: "{{summary}} · {{count}} more",
  },
};

type OfflineResources = typeof en;

const vi: OfflineResources = {
  theHub: "Hub",
  source: {
    hubUnreachable:
      "{{source}}: Không kết nối được {{hub}}. Nếu Hub này dùng qua VPN, hãy kiểm tra kết nối đó.",
    hubSignIn: "{{source}}: hãy đăng nhập lại {{hub}}.",
    revoked: "{{source}}: quyền truy cập đã bị gỡ.",
    hostSignIn: "{{source}}: hãy nhập lại mật khẩu Host.",
    hostUnreachable: "{{source}}: {{error}}",
    disconnected: "Mất kết nối. Hãy kết nối lại để làm mới các cuộc trò chuyện.",
    directoryFailed: "Không tải được danh sách",
  },
  hub: {
    unreachable: "Không kết nối được {{hub}}. Nếu Hub này dùng qua VPN, hãy kiểm tra kết nối đó.",
    needsSignIn: "Hãy đăng nhập lại {{hub}}.",
    revoked: "Quyền truy cập của bạn vào {{hub}} đã bị gỡ.",
    timedOut: "Hub không phản hồi trong {{seconds}} giây",
    partial: "{{hub}}: kết nối được {{reachable}}/{{total}}",
  },
  notice: {
    more: "{{summary}} · thêm {{count}} nguồn",
  },
};

export const offlineResources: Readonly<Record<string, OfflineResources>> = {
  en,
  vi,
};
