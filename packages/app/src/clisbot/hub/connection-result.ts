import { i18n } from "@/i18n/i18next";
import { HUB_PROVIDER_APPLICATION_PROVIDERS } from "./provider-application-form";

interface HubConnectionResult {
  variant: "success" | "info" | "warning" | "error";
  title: string;
  description: string;
}

/** Results the Hub returns by code; read when the callback is shown so it follows the language. */
function connectionResults(): Readonly<Record<string, HubConnectionResult>> {
  return {
    github_approval_required: {
      variant: "warning",
      title: i18n.t("hub.account.connectionResults.githubApprovalRequired.title"),
      description: i18n.t("hub.account.connectionResults.githubApprovalRequired.description"),
    },
    slack_bot_failed: {
      variant: "error",
      title: i18n.t("hub.account.connectionResults.slackBotFailed.title"),
      description: i18n.t("hub.account.connectionResults.slackBotFailed.description"),
    },
    provider_not_configured: {
      variant: "warning",
      title: i18n.t("hub.account.connectionResults.providerNotConfigured.title"),
      description: i18n.t("hub.account.connectionResults.providerNotConfigured.description"),
    },
    connection_invalid: {
      variant: "error",
      title: i18n.t("hub.account.connectionResults.connectionInvalid.title"),
      description: i18n.t("hub.account.connectionResults.connectionInvalid.description"),
    },
    connection_conflict: {
      variant: "error",
      title: i18n.t("hub.account.connectionResults.connectionConflict.title"),
      description: i18n.t("hub.account.connectionResults.connectionConflict.description"),
    },
  };
}
const PROVIDER_LABELS = { github: "GitHub", slack: "Slack", discord: "Discord", linear: "Linear" };

/** Callback copy is informational; the authenticated inventories own actual Connection status. */
export function hubConnectionResult(input: {
  app?: string | string[];
  result?: string | string[];
}): HubConnectionResult | null {
  if (typeof input.result !== "string") return null;
  if (
    input.app !== undefined &&
    (typeof input.app !== "string" ||
      !HUB_PROVIDER_APPLICATION_PROVIDERS.some((provider) => provider === input.app))
  ) {
    return null;
  }
  const resultCode = input.result;
  const resultProvider = HUB_PROVIDER_APPLICATION_PROVIDERS.find((provider) =>
    resultCode.startsWith(`${provider}_`),
  );
  if (input.app !== undefined && resultProvider !== undefined && input.app !== resultProvider)
    return null;
  const results = connectionResults();
  const known = Object.hasOwn(results, resultCode) ? results[resultCode] : undefined;
  if (known !== undefined) return known;
  if (resultProvider === undefined) return null;
  const label = PROVIDER_LABELS[resultProvider];
  if (resultCode === `${resultProvider}_connected`) {
    return {
      variant: "success",
      title: i18n.t("hub.account.connectionResults.completed.title", { provider: label }),
      description: i18n.t("hub.account.connectionResults.completed.description"),
    };
  }
  if (resultCode === `${resultProvider}_cancelled`) {
    return {
      variant: "info",
      title: i18n.t("hub.account.connectionResults.cancelled.title", { provider: label }),
      description: i18n.t("hub.account.connectionResults.cancelled.description"),
    };
  }
  return null;
}
