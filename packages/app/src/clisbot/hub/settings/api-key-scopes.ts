import { i18n } from "@/i18n/i18next";

/** The operations a Hub API key may be granted, with how the UI names them. */
export const API_KEY_SCOPES = [
  "projects:read",
  "configuration:validate",
  "configuration:install",
  "runs:dispatch",
  "daemons:enroll",
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** How the UI names a scope, resolved when shown so it follows the app language. */
export function scopeDetails(scope: ApiKeyScope): { label: string; description: string } {
  switch (scope) {
    case "projects:read":
      return {
        label: i18n.t("hub.settings.apiKeys.scopes.projectsRead.label"),
        description: i18n.t("hub.settings.apiKeys.scopes.projectsRead.description"),
      };
    case "configuration:validate":
      return {
        label: i18n.t("hub.settings.apiKeys.scopes.configurationValidate.label"),
        description: i18n.t("hub.settings.apiKeys.scopes.configurationValidate.description"),
      };
    case "configuration:install":
      return {
        label: i18n.t("hub.settings.apiKeys.scopes.configurationInstall.label"),
        description: i18n.t("hub.settings.apiKeys.scopes.configurationInstall.description"),
      };
    case "runs:dispatch":
      return {
        label: i18n.t("hub.settings.apiKeys.scopes.runsDispatch.label"),
        description: i18n.t("hub.settings.apiKeys.scopes.runsDispatch.description"),
      };
    case "daemons:enroll":
      return {
        label: i18n.t("hub.settings.apiKeys.scopes.daemonsEnroll.label"),
        description: i18n.t("hub.settings.apiKeys.scopes.daemonsEnroll.description"),
      };
  }
}
