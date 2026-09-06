import { channelAccountResourceId } from "./channel-configuration";
import { parse } from "yaml";
import type { z } from "zod";
import type { HubApiClient } from "./api-client";
import { createAutomation } from "./automation-management";
import {
  HubAutomationSchema,
  HubAutomationValidationSchema,
  HubChannelConfigurationSchema,
  HubChannelValidationSchema,
  HubAccessAssignmentsSchema,
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
      await api.post("channel-configuration/validate", candidate, HubChannelValidationSchema);
      const saved = await api.put(
        "channel-configuration",
        {
          ...candidate,
          expectedRevisionId:
            progress.channelRevisionId === undefined
              ? draft.expectedRevisionId
              : progress.channelRevisionId,
        },
        HubChannelConfigurationSchema,
      );
      progress.channelRevisionId = saved.revision?.id ?? null;
      progress.channelSource = source;
    }
    stage = "Channel access";
    const assignments = draft.grants.flatMap((grant) =>
      grant.teamIds.map((teamId) => ({
        subjectKind: "team",
        subjectId: teamId,
        resourceKind: "channel_account",
        resourceId: channelAccountResourceId(grant.channel, grant.accountId),
        privileges: ["channel.use"],
        constraints: { conversation: grant.conversation },
      })),
    );
    if (assignments.length)
      await api.post("access-assignments/batch", { assignments }, HubAccessAssignmentsSchema);
    return progress.automation;
  } catch (cause) {
    throw new Error(
      `${stage} could not be saved. ${progress.automation ? "The Automation is saved and active, but input setup is incomplete; retry to finish." : "No Automation has been saved."} ${cause instanceof Error ? cause.message : "Request failed."}`,
      { cause },
    );
  }
}
