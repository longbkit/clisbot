/** The operations a Hub API key may be granted, with how the UI names them. */
export const API_KEY_SCOPES = [
  "projects:read",
  "configuration:validate",
  "configuration:install",
  "runs:dispatch",
  "daemons:enroll",
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const SCOPE_DETAILS: Record<ApiKeyScope, { label: string; description: string }> = {
  "projects:read": {
    label: "Read Projects",
    description: "List Project configuration through the public API.",
  },
  "configuration:validate": {
    label: "Validate configuration",
    description: "Check configuration without activating it.",
  },
  "configuration:install": {
    label: "Install configuration",
    description: "Activate Project configuration revisions.",
  },
  "runs:dispatch": {
    label: "Start Automation runs",
    description: "Dispatch configured Automation runs.",
  },
  "daemons:enroll": {
    label: "Enroll Hosts",
    description: "Issue short-lived daemon enrollment tokens.",
  },
};
