export const HUB_SECTION_SLUGS = [
  "account",
  "channels",
  "automations",
  "team",
  "access",
  "configuration",
] as const;

export type HubSectionSlug = (typeof HUB_SECTION_SLUGS)[number];

export function isHubSectionSlug(value: string): value is HubSectionSlug {
  return (HUB_SECTION_SLUGS as readonly string[]).includes(value);
}

export function buildHubSettingsRoute<const Section extends HubSectionSlug>(section: Section) {
  return `/settings/hub/${section}` as const;
}
