export const HUB_PROVIDER_APPLICATION_PROVIDERS = ["github", "slack", "discord", "linear"] as const;

export type HubProviderApplicationProvider = (typeof HUB_PROVIDER_APPLICATION_PROVIDERS)[number];
export type HubSlackTransport = "socket" | "webhook";

export type HubProviderApplicationSubmission =
  | {
      provider: "github";
      appId: string;
      appSlug: string;
      clientId: string;
      clientSecret: string;
      privateKey: string;
      webhookSecret?: string;
      expectedVersion?: number;
    }
  | {
      provider: "slack";
      transport: "webhook";
      appId: string;
      clientId: string;
      clientSecret: string;
      signingSecret: string;
      expectedVersion?: number;
    }
  | {
      provider: "slack";
      transport: "socket";
      appToken: string;
      botToken: string;
      expectedVersion?: number;
    }
  | {
      provider: "discord";
      applicationId: string;
      clientSecret: string;
      botToken: string;
      expectedVersion?: number;
    }
  | {
      provider: "linear";
      clientId: string;
      clientSecret: string;
      webhookSecret: string;
      expectedVersion?: number;
    };

export const HUB_PROVIDER_APPLICATION_FIELDS = [
  "appId",
  "appSlug",
  "applicationId",
  "clientId",
  "clientSecret",
  "privateKey",
  "webhookSecret",
  "signingSecret",
  "appToken",
  "botToken",
] as const;
export type HubProviderApplicationField = (typeof HUB_PROVIDER_APPLICATION_FIELDS)[number];

export interface HubProviderApplicationFormSnapshot {
  provider?: HubProviderApplicationProvider;
  transport?: HubSlackTransport;
  application?: {
    identifiers: Readonly<Record<string, string>>;
    configurationVersion: number | null;
  };
}

export interface HubProviderApplicationFormState {
  mode: "create" | "replace";
  provider: HubProviderApplicationProvider;
  transport: HubSlackTransport | undefined;
  fields: Readonly<Record<HubProviderApplicationField, string>>;
  submitting: boolean;
  error: string | null;
  canSubmit: boolean;
  submission: HubProviderApplicationSubmission | null;
}

export interface HubProviderApplicationFormModel {
  getState(): HubProviderApplicationFormState;
  subscribe(listener: () => void): () => void;
  close(): void;
  setProvider(provider: HubProviderApplicationProvider): void;
  setSlackTransport(transport: HubSlackTransport): void;
  setField(field: HubProviderApplicationField, value: string): void;
  setSubmitting(submitting: boolean): void;
  setError(error: string | null): void;
}

export function providerApplicationCanConnectAccount(application: {
  provider: HubProviderApplicationProvider;
  identifiers: Readonly<Record<string, string>>;
}): boolean {
  return application.provider !== "slack" || application.identifiers.transport === "webhook";
}

const EMPTY_FIELDS: Readonly<Record<HubProviderApplicationField, string>> = {
  appId: "",
  appSlug: "",
  applicationId: "",
  clientId: "",
  clientSecret: "",
  privateKey: "",
  webhookSecret: "",
  signingSecret: "",
  appToken: "",
  botToken: "",
};

export function openHubProviderApplicationForm(
  snapshot: HubProviderApplicationFormSnapshot = {},
): HubProviderApplicationFormModel {
  const listeners = new Set<() => void>();
  let closed = false;
  const mode = snapshot.application === undefined ? "create" : "replace";
  let provider = snapshot.provider ?? "github";
  let slackTransport = snapshot.transport ?? "socket";
  let fields = seedFields(snapshot.application?.identifiers);
  let submitting = false;
  let error: string | null = null;
  let state = derive();

  function derive(): HubProviderApplicationFormState {
    const submission = buildSubmission(
      provider,
      slackTransport,
      fields,
      snapshot.application?.configurationVersion ?? null,
    );
    return {
      mode,
      provider,
      transport: provider === "slack" ? slackTransport : undefined,
      fields,
      submitting,
      error,
      canSubmit: !submitting && submission !== null,
      submission,
    };
  }

  function publish() {
    if (closed) return;
    state = derive();
    for (const listener of listeners) listener();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      if (closed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      listeners.clear();
    },
    setProvider(nextProvider) {
      if (mode === "replace" || nextProvider === provider) return;
      provider = nextProvider;
      fields = { ...EMPTY_FIELDS };
      error = null;
      publish();
    },
    setSlackTransport(nextTransport) {
      if (provider !== "slack" || nextTransport === slackTransport) return;
      slackTransport = nextTransport;
      fields = { ...EMPTY_FIELDS };
      error = null;
      publish();
    },
    setField(field, value) {
      fields = { ...fields, [field]: value };
      error = null;
      publish();
    },
    setSubmitting(value) {
      submitting = value;
      publish();
    },
    setError(value) {
      error = value;
      publish();
    },
  };
}

function seedFields(
  identifiers: Readonly<Record<string, string>> | undefined,
): Record<HubProviderApplicationField, string> {
  return {
    ...EMPTY_FIELDS,
    appId: identifiers?.appId ?? "",
    appSlug: identifiers?.appSlug ?? "",
    applicationId: identifiers?.applicationId ?? "",
    clientId: identifiers?.clientId ?? "",
  };
}

function buildSubmission(
  provider: HubProviderApplicationProvider,
  slackTransport: HubSlackTransport,
  fields: Readonly<Record<HubProviderApplicationField, string>>,
  configurationVersion: number | null,
): HubProviderApplicationSubmission | null {
  const expectedVersion =
    configurationVersion === null || configurationVersion <= 0
      ? {}
      : { expectedVersion: configurationVersion };
  if (provider === "github") {
    if (!present(fields, ["appId", "appSlug", "clientId", "clientSecret", "privateKey"])) {
      return null;
    }
    return {
      provider,
      appId: fields.appId.trim(),
      appSlug: fields.appSlug.trim(),
      clientId: fields.clientId.trim(),
      clientSecret: fields.clientSecret,
      privateKey: fields.privateKey,
      ...(fields.webhookSecret.trim() === "" ? {} : { webhookSecret: fields.webhookSecret }),
      ...expectedVersion,
    };
  }
  if (provider === "slack") {
    if (slackTransport === "socket") {
      if (!present(fields, ["appToken", "botToken"])) return null;
      return {
        provider,
        transport: slackTransport,
        appToken: fields.appToken,
        botToken: fields.botToken,
        ...expectedVersion,
      };
    }
    if (!present(fields, ["appId", "clientId", "clientSecret", "signingSecret"])) return null;
    return {
      provider,
      transport: slackTransport,
      appId: fields.appId.trim(),
      clientId: fields.clientId.trim(),
      clientSecret: fields.clientSecret,
      signingSecret: fields.signingSecret,
      ...expectedVersion,
    };
  }
  if (provider === "discord") {
    if (!present(fields, ["applicationId", "clientSecret", "botToken"])) return null;
    return {
      provider,
      applicationId: fields.applicationId.trim(),
      clientSecret: fields.clientSecret,
      botToken: fields.botToken,
      ...expectedVersion,
    };
  }
  if (!present(fields, ["clientId", "clientSecret", "webhookSecret"])) return null;
  return {
    provider,
    clientId: fields.clientId.trim(),
    clientSecret: fields.clientSecret,
    webhookSecret: fields.webhookSecret,
    ...expectedVersion,
  };
}

function present(
  fields: Readonly<Record<HubProviderApplicationField, string>>,
  required: readonly HubProviderApplicationField[],
): boolean {
  return required.every((field) => fields[field].trim().length > 0);
}

export function isHubProviderApplicationField(value: string): value is HubProviderApplicationField {
  return HUB_PROVIDER_APPLICATION_FIELDS.some((field) => field === value);
}
