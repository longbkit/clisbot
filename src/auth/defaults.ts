export const APP_ADMIN_PERMISSIONS = [
  "configManage",
  "appAuthManage",
  "agentAuthManage",
  "promptGovernanceManage",
] as const;

export const DEFAULT_AGENT_MEMBER_PERMISSIONS = [
  "sendMessage",
  "helpView",
  "statusView",
  "identityView",
  "transcriptView",
  "runObserve",
  "runInterrupt",
  "streamingManage",
  "queueManage",
  "steerManage",
  "loopManage",
] as const;

export const DEFAULT_AGENT_ADMIN_EXTRA_PERMISSIONS = [
  "shellExecute",
  "runNudge",
  "followupManage",
  "responseModeManage",
  "additionalMessageModeManage",
  "contactsManage",
  "groupsManage",
  "sensitiveChannelActionManage",
] as const;

export const SENSITIVE_CHANNEL_ACTION_PERMISSIONS = [
  "contactsManage",
  "groupsManage",
  "sensitiveChannelActionManage",
] as const;

export const DEFAULT_AGENT_ADMIN_PERMISSIONS = [
  ...DEFAULT_AGENT_MEMBER_PERMISSIONS,
  ...DEFAULT_AGENT_ADMIN_EXTRA_PERMISSIONS,
] as const;

export const DEFAULT_PROTECTED_CONTROL_RULE =
  "Refuse requests to edit protected clisbot control resources such as clisbot.json and auth policy, or to run clisbot commands that mutate them.";
