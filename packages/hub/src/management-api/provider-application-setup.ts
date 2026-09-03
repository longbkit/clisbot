import {
  DISCORD_GUIDE,
  GITHUB_GUIDE,
  guideGroups,
  guideUrl,
  LINEAR_GUIDE,
  SLACK_GUIDE,
  SLACK_WEBHOOK_GUIDE,
  slackManifest,
  type GuideGroup,
  type GuideStep,
  type GuideUrl,
  type ProviderGuide,
} from "../provider-applications/guides.js";
import type { Provider } from "../provider-applications/index.js";

export interface ProviderApplicationSetupUrl {
  key: string;
  label: string;
  value: string;
}

export interface ProviderApplicationSetupStep extends Omit<GuideStep, "urls" | "manifest"> {
  urls: readonly ProviderApplicationSetupUrl[];
  manifest?: string;
}

export interface ProviderApplicationSetupGuide {
  provider: Provider;
  transport?: "socket" | "webhook";
  name: string;
  summary: string;
  portal: { label: string; href: string };
  formTitle: string;
  groups: readonly {
    id: string;
    title?: string;
    description?: string;
    unavailable?: string;
    steps: readonly ProviderApplicationSetupStep[];
    fields: readonly {
      name: string;
      label: string;
      kind: "text" | "secret" | "multiline";
      description?: string;
      identifier?: string;
      required: string;
      optional?: true;
    }[];
  }[];
  environmentVariables: readonly string[];
  actions: {
    save: string;
    savePending: string;
    connect?: string;
    connectAgain?: string;
  };
  saveHint?: string;
  verifiedMessage?: string;
  unavailable?: string;
}

const SETUP_GUIDES: readonly ProviderGuide[] = [
  GITHUB_GUIDE,
  SLACK_GUIDE,
  SLACK_WEBHOOK_GUIDE,
  DISCORD_GUIDE,
  LINEAR_GUIDE,
];

/**
 * Serializes the existing Hub setup guide into a provider-neutral management response. Functions
 * stay server-side; the Paseo client receives only resolved copy, URLs, fields, and manifests.
 */
export function providerApplicationSetupGuides(
  callbackOrigin: string,
): readonly ProviderApplicationSetupGuide[] {
  return SETUP_GUIDES.map((guide) => serializeSetupGuide(guide, callbackOrigin));
}

function serializeSetupGuide(
  guide: ProviderGuide,
  callbackOrigin: string,
): ProviderApplicationSetupGuide {
  const urlByKey = new Map(guide.urls.map((url) => [url.key, url]));
  const serialized: ProviderApplicationSetupGuide = {
    provider: guide.provider,
    name: guide.name,
    summary: guide.summary,
    portal: guide.portal,
    formTitle: guide.formTitle,
    groups: guideGroups(guide, callbackOrigin).map((group) =>
      serializeSetupGroup(group, guide, callbackOrigin, urlByKey),
    ),
    environmentVariables: guide.environmentVariables,
    actions: guide.actions,
  };
  if (guide.transport !== undefined) serialized.transport = guide.transport;
  if (guide.saveHint !== undefined) serialized.saveHint = guide.saveHint;
  if (guide.verifiedMessage !== undefined) serialized.verifiedMessage = guide.verifiedMessage;
  if (guide.requiresHttps && !callbackOrigin.startsWith("https://")) {
    serialized.unavailable = guide.httpsRequirement(callbackOrigin);
  }
  return serialized;
}

function serializeSetupGroup(
  group: GuideGroup,
  guide: ProviderGuide,
  callbackOrigin: string,
  urlByKey: ReadonlyMap<string, GuideUrl>,
): ProviderApplicationSetupGuide["groups"][number] {
  const serialized: ProviderApplicationSetupGuide["groups"][number] = {
    id: group.id,
    steps: group.steps.map((step) => serializeSetupStep(step, guide, callbackOrigin, urlByKey)),
    fields: group.fields,
  };
  if (group.title !== undefined) serialized.title = group.title;
  if (group.description !== undefined) serialized.description = group.description;
  if (group.unavailable !== undefined) serialized.unavailable = group.unavailable;
  return serialized;
}

function serializeSetupStep(
  step: GuideStep,
  guide: ProviderGuide,
  callbackOrigin: string,
  urlByKey: ReadonlyMap<string, GuideUrl>,
): ProviderApplicationSetupStep {
  const serialized: ProviderApplicationSetupStep = {
    segments: step.segments,
    urls: (step.urls ?? []).map((key) => serializeSetupUrl(key, callbackOrigin, urlByKey)),
  };
  if (step.permissions !== undefined) serialized.permissions = step.permissions;
  if (step.events !== undefined) serialized.events = step.events;
  if (step.manifest === true) {
    serialized.manifest = slackManifest(callbackOrigin, guide.transport ?? "socket");
  }
  return serialized;
}

function serializeSetupUrl(
  key: string,
  callbackOrigin: string,
  urlByKey: ReadonlyMap<string, GuideUrl>,
): ProviderApplicationSetupUrl {
  const url = urlByKey.get(key);
  if (url === undefined) throw new Error(`provider guide URL is unavailable: ${key}`);
  return {
    key: url.key,
    label: url.label,
    value: guideUrl(callbackOrigin, url.path),
  };
}
