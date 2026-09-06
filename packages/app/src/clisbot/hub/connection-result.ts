import { HUB_PROVIDER_APPLICATION_PROVIDERS } from "./provider-application-form";

interface HubConnectionResult {
  variant: "success" | "info" | "warning" | "error";
  title: string;
  description: string;
}

const CONNECTION_RESULTS: Readonly<Record<string, HubConnectionResult>> = {
  github_approval_required: {
    variant: "warning",
    title: "GitHub owner approval required",
    description:
      "Ask a GitHub organization owner to approve this installation, then connect again.",
  },
  slack_bot_failed: {
    variant: "error",
    title: "Slack permissions are incomplete",
    description:
      "Apply the setup guide's manifest in Slack, then install again. Hub did not save this Connection.",
  },
  provider_not_configured: {
    variant: "warning",
    title: "Provider application required",
    description: "Verify and save the Provider Application before connecting an account.",
  },
  connection_invalid: {
    variant: "error",
    title: "Connection link unavailable",
    description: "This setup link expired or was already used. Start Connect account again below.",
  },
  connection_conflict: {
    variant: "error",
    title: "Account connected elsewhere",
    description:
      "Disconnect the provider account from its other organization, or choose a different account.",
  },
};
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
  const known = Object.hasOwn(CONNECTION_RESULTS, resultCode)
    ? CONNECTION_RESULTS[resultCode]
    : undefined;
  if (known !== undefined) return known;
  if (resultProvider === undefined) return null;
  const label = PROVIDER_LABELS[resultProvider];
  if (resultCode === `${resultProvider}_connected`) {
    return {
      variant: "success",
      title: `${label} setup completed`,
      description:
        "The provider returned from setup. The refreshed list below shows the current Connection status.",
    };
  }
  if (resultCode === `${resultProvider}_cancelled`) {
    return {
      variant: "info",
      title: `${label} setup cancelled`,
      description: "Start Connect account again when you are ready.",
    };
  }
  return null;
}
