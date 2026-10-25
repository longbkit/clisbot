/**
 * Global search scope copy (docs/features/global-search/README.md). A separate `searchScope`
 * namespace so these keys merge without touching the shared per-locale resource files; locales
 * other than en and vi fall back to en.
 */
const en = {
  sections: { projects: "Projects", hosts: "Hosts" },
  chip: {
    remove: "Remove {{label}} filter",
    hub: "{{name}} ({{count}})",
    clearAll: "Clear filters",
    onlyCurrentFilter: "Only current filter ({{label}})",
  },
  host: {
    thisComputer: "This computer",
    direct: "Direct",
    online: "Online",
    connecting: "Connecting",
    offline: "Offline",
    lastOnline: "Offline · last online {{time}}",
    noProject: "No {{project}}",
  },
  hubRow: {
    hosts_one: "{{count}} Host",
    hosts_other: "{{count}} Hosts",
    online: "{{count}} online",
  },
  project: {
    onHosts_one: "on {{count}} Host",
    onHosts_other: "on {{count}} Hosts",
    onHost: "on {{host}}",
    notInScope: "Not on your Host filter",
  },
  sessions_one: "{{count}} session",
  sessions_other: "{{count}} sessions",
  note: {
    outsideFilter: "Outside filter",
    offlineCached: "Offline · cached {{time}}",
    offline: "Offline · cached",
  },
  empty: {
    noMatchesIn: "No “{{query}}” in {{scope}}",
    nothingIn: "Nothing in {{scope}} yet",
    removeHostFilter: "Remove Host filter",
    removeProjectFilter: "Remove Project filter",
    searchEverywhere: "Search everywhere",
  },
  offlineNotice: "{{host}} is offline. Showing cached results.",
  showInWork: "Show in Work",
  showInWorkLabel: "Show {{label}} in Work",
  workFilterChanged: "Work now shows {{label}}",
  undo: "Undo",
};

type SearchScopeResources = typeof en;

const vi: SearchScopeResources = {
  sections: { projects: "Dự án", hosts: "Host" },
  chip: {
    remove: "Bỏ bộ lọc {{label}}",
    hub: "{{name}} ({{count}})",
    clearAll: "Xoá bộ lọc",
    onlyCurrentFilter: "Chỉ bộ lọc hiện tại ({{label}})",
  },
  host: {
    thisComputer: "Máy này",
    direct: "Kết nối trực tiếp",
    online: "Trực tuyến",
    connecting: "Đang kết nối",
    offline: "Ngoại tuyến",
    lastOnline: "Ngoại tuyến · trực tuyến lần cuối {{time}}",
    noProject: "Không có {{project}}",
  },
  hubRow: {
    hosts_one: "{{count}} Host",
    hosts_other: "{{count}} Host",
    online: "{{count}} trực tuyến",
  },
  project: {
    onHosts_one: "trên {{count}} Host",
    onHosts_other: "trên {{count}} Host",
    onHost: "trên {{host}}",
    notInScope: "Không có trên Host đang lọc",
  },
  sessions_one: "{{count}} phiên",
  sessions_other: "{{count}} phiên",
  note: {
    outsideFilter: "Ngoài bộ lọc",
    offlineCached: "Ngoại tuyến · lưu lúc {{time}}",
    offline: "Ngoại tuyến · dữ liệu đã lưu",
  },
  empty: {
    noMatchesIn: "Không có “{{query}}” trong {{scope}}",
    nothingIn: "Chưa có gì trong {{scope}}",
    removeHostFilter: "Bỏ lọc Host",
    removeProjectFilter: "Bỏ lọc dự án",
    searchEverywhere: "Tìm ở mọi nơi",
  },
  offlineNotice: "{{host}} đang ngoại tuyến. Đang hiện kết quả đã lưu.",
  showInWork: "Xem trong Work",
  showInWorkLabel: "Xem {{label}} trong Work",
  workFilterChanged: "Work đang hiện {{label}}",
  undo: "Hoàn tác",
};

export const searchScopeResources: Readonly<Record<string, SearchScopeResources>> = { en, vi };
