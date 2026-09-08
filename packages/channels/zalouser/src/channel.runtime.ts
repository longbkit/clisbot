// upstream: extensions/zalouser/src/channel.runtime.ts@5d8067a4483
// D-ZU-011: `collectZalouserSecurityAuditFindings` is dropped with
// `security-audit.ts` (the OpenClaw `doctor` config-audit surface the Hub owns).
// Every other member is carried, so the lazy runtime module the adapters import
// keeps upstream's name and job.
// Zalouser plugin module implements channel behavior.
export { probeZalouser } from "./probe.js";
export { sendMessageZalouser, sendReactionZalouser } from "./send.js";
export {
  listZaloFriendsMatching,
  listZaloGroupMembers,
  listZaloGroupsMatching,
  logoutZaloProfile,
  startZaloQrLogin,
  waitForZaloQrLogin,
  getZaloUserInfo,
} from "./zalo-js.js";
