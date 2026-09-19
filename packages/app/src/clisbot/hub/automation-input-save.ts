import { parse } from "yaml";
import type { z } from "zod";
import type { HubApiClient } from "./api-client";
import { createAutomation } from "./automation-management";
import { saveChangedAccounts } from "./channel-account-requests";
import {
  HubAutomationSchema,
  HubAutomationValidationSchema,
  HubChannelConfigurationSchema,
  HubChannelValidationSchema,
} from "./contracts";
import type { AutomationChannelDraft } from "./settings/automation-input-draft";

export interface AutomationInputSaveProgress {
  automation?: Pick<
    z.infer<typeof HubAutomationSchema>,
    "id" | "name" | "yaml" | "enabled" | "activeRevisionId"
  >;
  channelRevisionId?: string | null;
  channelSource?: string;
}

/**
 * Save the staged Routes. An author who is Channel Route Admin of some accounts
 * (not an Organization Admin) saves each changed account through its own
 * endpoint, which re-checks their delegation; the organization capability saves
 * the whole configuration. Returns the revision the save produced.
 */
async function saveChannelInputs(
  api: HubApiClient,
  draft: AutomationChannelDraft,
  expectedRevisionId: string | null,
): Promise<string | null> {
  if (draft.scope === "accounts") {
    return saveChangedAccounts(api, draft.accounts, draft.savedAccounts ?? [], expectedRevisionId);
  }
  const candidate = { accounts: draft.accounts, resource: draft.resource, policy: draft.policy };
  await api.post("channel-configuration/validate", candidate, HubChannelValidationSchema);
  const saved = await api.put(
    "channel-configuration",
    { ...candidate, expectedRevisionId },
    HubChannelConfigurationSchema,
  );
  return saved.revision?.id ?? null;
}

/** Resume after partial failure without creating another Automation or overwriting newer Routes. */
export async function saveAutomationWithInputs(
  api: HubApiClient,
  yaml: string,
  draft: AutomationChannelDraft,
  progress: AutomationInputSaveProgress,
) {
  if (parse(yaml).enabled === false)
    throw new Error("Channel inputs require an active Automation. Enable Active before saving.");
  let stage = "Automation";
  try {
    if (!progress.automation) progress.automation = await createAutomation(api, yaml);
    else if (progress.automation.yaml !== yaml) {
      await api.post("automations/validate", { yaml }, HubAutomationValidationSchema);
      progress.automation = await api.put(
        `automations/${encodeURIComponent(progress.automation.id)}`,
        {
          expectedRevisionId: progress.automation.activeRevisionId,
          yaml,
        },
        HubAutomationSchema,
      );
    }
    stage = "Channel inputs";
    const candidate = { accounts: draft.accounts, resource: draft.resource, policy: draft.policy };
    const source = JSON.stringify(candidate);
    if (source !== progress.channelSource) {
      const expectedRevisionId =
        progress.channelRevisionId === undefined
          ? draft.expectedRevisionId
          : progress.channelRevisionId;
      progress.channelRevisionId = await saveChannelInputs(api, draft, expectedRevisionId);
      progress.channelSource = source;
    }
    return progress.automation;
  } catch (cause) {
    throw new Error(
      `${stage} could not be saved. ${progress.automation ? "The Automation is saved and active, but input setup is incomplete; retry to finish." : "No Automation has been saved."} ${cause instanceof Error ? cause.message : "Request failed."}`,
      { cause },
    );
  }
}
