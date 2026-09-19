export const HUB_SECTION_SLUGS = [
  "account",
  "channels",
  "automations",
  "team",
  "hosts",
  "integrations",
  "instance",
] as const;

export type HubSectionSlug = (typeof HUB_SECTION_SLUGS)[number];

export function isHubSectionSlug(value: string): value is HubSectionSlug {
  return (HUB_SECTION_SLUGS as readonly string[]).includes(value);
}

/**
 * Slugs that moved (2026-09-19, docs/audits/2026-09-19-connection-naming-and-route-flow.md).
 * The Hub still links to them (the Administrator notice, a Provider Application
 * install's return), so they redirect instead of 404ing: Access became People's
 * Access tab, Configuration became Integrations.
 */
export const MOVED_HUB_SECTIONS: Readonly<
  Record<string, { section: HubSectionSlug; params?: Record<string, string> }>
> = {
  access: { section: "team", params: { view: "access" } },
  configuration: { section: "integrations" },
};

export function buildHubSettingsRoute<const Section extends HubSectionSlug>(section: Section) {
  return `/settings/hub/${section}` as const;
}
