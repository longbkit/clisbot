export const PROVIDER_EVENT_DROP_REASON_CODES = [
  "no_project_route",
  "no_trigger_for_source",
  "trigger_filters_rejected",
  "configuration_unavailable",
] as const;

export type ProviderEventDropReasonCode = (typeof PROVIDER_EVENT_DROP_REASON_CODES)[number];

const SUMMARIES: Readonly<Record<ProviderEventDropReasonCode, string>> = {
  no_project_route: "No project route is configured for this event.",
  no_trigger_for_source: "No configured trigger handles this event.",
  trigger_filters_rejected: "The event did not pass the configured trigger filters.",
  configuration_unavailable: "The relevant configuration or connection is unavailable.",
};

export function isProviderEventDropReasonCode(value: string): value is ProviderEventDropReasonCode {
  return PROVIDER_EVENT_DROP_REASON_CODES.some((code) => code === value);
}

export function providerEventDropReasonSummary(value: string): string | null {
  return isProviderEventDropReasonCode(value) ? SUMMARIES[value] : null;
}
