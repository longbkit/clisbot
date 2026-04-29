export function renderCanonicalRouteIdList() {
  return "`dm:<id>`, `dm:*`, `group:<id>`, `group:*`, and `topic:<chatId>:<topicId>`";
}

export function renderLegacyCompatibleRouteInputList() {
  return "`channel:<id>` and `groups:*`";
}

export function renderSlackRouteIdSyntax() {
  return "group:<id>, group:*, or dm:<id|*>";
}

export function renderTelegramRouteIdSyntax() {
  return "group:<chatId>, topic:<chatId>:<topicId>, group:*, or dm:<id|*>";
}

export function renderSlackTargetSyntax() {
  return "`group:<id>`, `dm:<user-or-channel-id>`, or raw `C...` / `G...` / `D...` ids";
}

export function renderSlackTargetUsageError(targetLabel: string) {
  return `Slack ${targetLabel} must use group:<id>, dm:<user-or-channel-id>, or a raw C/G/D id.`;
}
