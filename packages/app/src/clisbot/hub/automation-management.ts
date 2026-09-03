import type { HubApiClient } from "./api-client";
import { HubAutomationSchema, HubAutomationValidationSchema } from "./contracts";

/** Validates and creates one Automation through the canonical management contract. */
export async function createAutomation(api: HubApiClient, yaml: string) {
  await api.post("automations/validate", { yaml }, HubAutomationValidationSchema);
  return api.post("automations", { expectedRevisionId: null, yaml }, HubAutomationSchema);
}
