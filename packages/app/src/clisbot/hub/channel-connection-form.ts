/**
 * The Add-connection form model: plain TypeScript, one instance per opened form
 * (docs/forms.md). The component renders `getState()` and dispatches commands;
 * it owns no field state of its own.
 *
 * Two contracts meet here and they are not the same list. `CONNECTION_SHAPES` is
 * the `POST connections` body the Hub accepts; the served catalog entry supplies
 * each field's label and help and the transports to choose between.
 *
 * Secret values never leave this module. `getState()` publishes `filled`, not the
 * value; only `requestBody()` reads them, and only to build the request.
 */
import { i18n } from "@/i18n/i18next";
import {
  isConnectableChannel,
  supportedTransports,
  type ChannelCatalogEntry,
} from "./channel-catalog";

export type ChannelConnectionFieldKind = "text" | "secret" | "multiline" | "choice";

export interface ChannelConnectionChoice {
  readonly value: string;
  readonly label: string;
  /** One line under the label: what picking it means. */
  readonly description?: string;
}

/**
 * The credential shape of a channel's `POST connections` body. `token` is one
 * pasted secret, `fields` a set of them, `serviceAccount` a JSON document
 * supplied inline or by host path, `slackApp` the Provider-Application flow that
 * names its own Connection, and `qr` a login that produces no body at all.
 */
export type ChannelSetupKind = "token" | "fields" | "serviceAccount" | "slackApp" | "qr";

interface ChannelConnectionFieldSpec {
  /** The key inside the request's `credentials` object. */
  readonly key: string;
  /** The catalog credential that supplies the label and help, when there is one. */
  readonly catalogKey?: string;
  /** Resolved when the form state is built, so it follows the language. */
  readonly label?: () => string;
  readonly help?: string;
  readonly kind: ChannelConnectionFieldKind;
  /** The first choice is the default. */
  readonly choices?: () => readonly ChannelConnectionChoice[];
  readonly required?: boolean;
  /** Required only while one of these transports is selected. */
  readonly requiredForTransports?: readonly string[];
  readonly placeholder?: string;
  /** A prefix the Hub's own schema enforces; checked here for a faster answer. */
  readonly prefix?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
}

interface ChannelConnectionShape {
  readonly setup: ChannelSetupKind;
  readonly fields: readonly ChannelConnectionFieldSpec[];
}

/**
 * What `POST connections` accepts, per channel. This is the app's knowledge of
 * the Hub's request contract, not a copy of the catalog: the catalog says what a
 * credential is called and what it is for, the request body says which keys the
 * `.strict()` schema will take. Telegram's catalog entry carries
 * `webhookUrl`/`webhookSecret`, for instance, while its Connection credential is
 * a bot token alone. Zalo Personal's and WhatsApp's Connections are a name with
 * no credential: the account is linked by a QR scan once it runs.
 */
const CONNECTION_SHAPES: Readonly<Record<string, ChannelConnectionShape>> = {
  zalouser: {
    setup: "qr",
    fields: [],
  },
  // WhatsApp is QR-linked too. Its optional label defaults to the Connection
  // name, so the form asks for one name only.
  whatsapp: {
    setup: "qr",
    fields: [],
  },
  telegram: {
    setup: "token",
    fields: [{ key: "botToken", catalogKey: "botToken", kind: "secret", required: true }],
  },
  // The Discord vertical's config key is `token`; the Connection body's is `botToken`.
  discord: {
    setup: "token",
    fields: [{ key: "botToken", catalogKey: "token", kind: "secret", required: true }],
  },
  zalo: {
    setup: "token",
    fields: [
      { key: "botToken", catalogKey: "botToken", kind: "secret", required: true },
      {
        key: "webhookSecret",
        catalogKey: "webhookSecret",
        kind: "secret",
        requiredForTransports: ["webhook"],
        minLength: 8,
        maxLength: 256,
      },
    ],
  },
  feishu: {
    setup: "fields",
    fields: [
      { key: "appId", catalogKey: "appId", kind: "text", required: true, placeholder: "cli_…" },
      { key: "appSecret", catalogKey: "appSecret", kind: "secret", required: true },
      {
        key: "verificationToken",
        catalogKey: "verificationToken",
        kind: "secret",
        requiredForTransports: ["webhook"],
      },
      {
        key: "encryptKey",
        catalogKey: "encryptKey",
        kind: "secret",
        requiredForTransports: ["webhook"],
      },
      {
        key: "domain",
        label: () => i18n.t("hub.channels.connectionForm.domain"),
        kind: "choice",
        // The app exists on one platform only; the wrong one refuses the
        // long connection with "Incorrect domain name".
        choices: () => [
          {
            value: "lark",
            label: "Lark",
            description: i18n.t("hub.channels.connectionForm.larkDomain"),
          },
          {
            value: "feishu",
            label: "Feishu",
            description: i18n.t("hub.channels.connectionForm.feishuDomain"),
          },
        ],
        required: true,
      },
    ],
  },
  googlechat: {
    setup: "serviceAccount",
    fields: [
      {
        key: "serviceAccount",
        catalogKey: "serviceAccount",
        kind: "multiline",
        placeholder: '{"type":"service_account", …}',
      },
      {
        key: "serviceAccountFile",
        catalogKey: "serviceAccountFile",
        kind: "text",
        placeholder: "/etc/clisbot/googlechat.json",
      },
      {
        key: "subscription",
        catalogKey: "subscription",
        kind: "text",
        requiredForTransports: ["pubsub"],
        placeholder: "projects/<project>/subscriptions/<name>",
      },
    ],
  },
  slack: {
    setup: "slackApp",
    fields: [
      {
        key: "appToken",
        catalogKey: "appToken",
        kind: "secret",
        required: true,
        prefix: "xapp-",
        placeholder: "xapp-…",
      },
      {
        key: "botToken",
        catalogKey: "botToken",
        kind: "secret",
        required: true,
        prefix: "xoxb-",
        placeholder: "xoxb-…",
      },
    ],
  },
};

/**
 * The credential shape for a served catalog entry. A QR channel is a login, not
 * a credential form, and a channel with no shape has nothing an operator pastes.
 */
export function channelSetupKind(entry: ChannelCatalogEntry): ChannelSetupKind {
  if (entry.auth === "qr") return "qr";
  return CONNECTION_SHAPES[entry.id]?.setup ?? "token";
}

/** Whether this app build knows how to build a `POST connections` body for it. */
export function hasChannelConnectionForm(entry: ChannelCatalogEntry): boolean {
  return CONNECTION_SHAPES[entry.id] !== undefined;
}

/**
 * The channels an operator can add a Connection for right here: the Hub runs
 * them, this build can shape their request body, and the operator has the
 * authority the flow needs. Slack Socket Mode is created from a Provider
 * Application, which only an instance operator administers, so it is offered
 * only to one.
 */
export function connectableChannelEntries(
  entries: readonly ChannelCatalogEntry[],
  options: { allowProviderApplications: boolean },
): readonly ChannelCatalogEntry[] {
  return entries.filter(
    (entry) =>
      isConnectableChannel(entry) &&
      hasChannelConnectionForm(entry) &&
      (options.allowProviderApplications || channelSetupKind(entry) !== "slackApp"),
  );
}

export type ServiceAccountSource = "paste" | "file";

export interface ChannelConnectionFieldState {
  key: string;
  label: string;
  help: string | null;
  kind: ChannelConnectionFieldKind;
  choices: readonly ChannelConnectionChoice[] | null;
  required: boolean;
  placeholder: string | null;
  /** Non-secret value, for choices and plain text. A secret publishes null. */
  value: string | null;
  filled: boolean;
  error: string | null;
}

export interface ChannelConnectionFormState {
  channel: string;
  label: string;
  setup: ChannelSetupKind;
  /** Connection name; Slack Socket Mode names its Connection from the app itself. */
  accountId: string | null;
  /** The name the form suggested last; it follows the list until the person edits the name. */
  accountIdSuggestion: string;
  accountIdError: string | null;
  transports: readonly { id: string; label: string }[];
  transportId: string | null;
  serviceAccountSource: ServiceAccountSource | null;
  fields: readonly ChannelConnectionFieldState[];
  submitting: boolean;
  canSubmit: boolean;
  problem: ChannelConnectionProblem | null;
}

export interface ChannelConnectionFormModel {
  getState(): ChannelConnectionFormState;
  subscribe(listener: () => void): () => void;
  close(): void;
  setAccountId(value: string): void;
  /** The channel's Connection names, once they load: a new name must differ from each. */
  setTakenNames(names: readonly string[]): void;
  setTransport(id: string): void;
  setServiceAccountSource(source: ServiceAccountSource): void;
  setField(key: string, value: string): void;
  setSubmitting(submitting: boolean): void;
  setProblem(problem: ChannelConnectionProblem | null): void;
  /** The `POST connections` body, or null while the form cannot be submitted. */
  requestBody(): Record<string, unknown> | null;
}

/**
 * The Connection name the form starts with: the channel's id, numbered past the
 * names its Connections already use (`telegram`, `telegram-2`, …).
 */
export function defaultConnectionName(channel: string, taken: readonly string[]): string {
  const used = new Set(taken);
  let name = channel;
  for (let suffix = 2; used.has(name); suffix += 1) name = `${channel}-${String(suffix)}`;
  return name;
}

/** The names a channel's Connections use: a new Connection's name must differ. */
export function connectionNamesFor(
  channel: string,
  connections: readonly { provider: string; name: string }[],
): string[] {
  return connections.filter(({ provider }) => provider === channel).map(({ name }) => name);
}

export function openChannelConnectionForm(
  entry: ChannelCatalogEntry,
  takenNames: readonly string[] = [],
): ChannelConnectionFormModel {
  const channel = entry.id;
  const setup = channelSetupKind(entry);
  const specs = CONNECTION_SHAPES[channel]?.fields ?? [];
  const values = new Map<string, string>();
  const touched = new Set<string>();
  for (const spec of specs) {
    if (spec.kind === "choice") values.set(spec.key, spec.choices?.()[0]?.value ?? "");
  }
  let taken = takenNames;
  let accountIdSuggestion = setup === "slackApp" ? "" : defaultConnectionName(channel, taken);
  let accountId = accountIdSuggestion;
  let accountTouched = false;
  // Only the transports a Connection can use today are offered.
  const transports = supportedTransports(entry).map(({ id, label }) => ({ id, label }));
  const offered = new Set(transports.map(({ id }) => id));
  let transportId = transports[0]?.id ?? null;
  let source: ServiceAccountSource | null = setup === "serviceAccount" ? "paste" : null;
  let submitting = false;
  let problem: ChannelConnectionProblem | null = null;
  let state = build();
  const listeners = new Set<() => void>();

  /** The two service-account forms are one choice: only the chosen one shows. */
  function isServiceAccountForm(spec: ChannelConnectionFieldSpec): boolean {
    return (
      setup === "serviceAccount" &&
      (spec.key === "serviceAccount" || spec.key === "serviceAccountFile")
    );
  }

  function visible(spec: ChannelConnectionFieldSpec): boolean {
    // A field only an unsupported transport needs (a webhook secret) is not asked for.
    const only = spec.requiredForTransports;
    if (only !== undefined && !only.some((id) => offered.has(id))) return false;
    if (!isServiceAccountForm(spec)) return true;
    return spec.key === (source === "file" ? "serviceAccountFile" : "serviceAccount");
  }

  function required(spec: ChannelConnectionFieldSpec): boolean {
    if (spec.required === true) return true;
    if (isServiceAccountForm(spec)) return visible(spec);
    if (transportId === null) return false;
    return spec.requiredForTransports?.includes(transportId) === true;
  }

  function build(): ChannelConnectionFormState {
    const fields = specs
      .filter(visible)
      .map((spec) => fieldState(spec, entry, values, touched, required(spec)));
    // Adding under a taken name replaces that Connection's credential on the Hub, so a taken
    // name is an error from the start, typed or not.
    const issue = setup === "slackApp" ? null : accountIdIssue(accountId, taken, entry.label);
    const accountIdError = accountTouched || isTaken(accountId, taken) ? issue : null;
    return {
      channel,
      label: entry.label,
      setup,
      accountId: setup === "slackApp" ? null : accountId,
      accountIdSuggestion,
      accountIdError,
      transports,
      transportId,
      serviceAccountSource: source,
      fields,
      submitting,
      canSubmit:
        !submitting &&
        specs
          .filter(visible)
          .every((spec) => fieldIssue(spec, values.get(spec.key) ?? "", required(spec)) === null) &&
        issue === null,
      problem,
    };
  }

  function publish(): void {
    state = build();
    for (const listener of listeners) listener();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      listeners.clear();
      values.clear();
    },
    setAccountId(value) {
      accountId = value;
      accountTouched = true;
      problem = null;
      publish();
    },
    setTakenNames(names) {
      if (names.length === taken.length && names.every((name, index) => name === taken[index]))
        return;
      taken = names;
      if (!accountTouched && setup !== "slackApp") {
        accountIdSuggestion = defaultConnectionName(channel, taken);
        accountId = accountIdSuggestion;
      }
      publish();
    },
    setTransport(id) {
      if (!offered.has(id)) return;
      transportId = id;
      publish();
    },
    setServiceAccountSource(next) {
      source = next;
      publish();
    },
    setField(key, value) {
      values.set(key, value);
      touched.add(key);
      problem = null;
      publish();
    },
    setSubmitting(next) {
      submitting = next;
      publish();
    },
    setProblem(next) {
      problem = next;
      submitting = false;
      publish();
    },
    requestBody() {
      if (!state.canSubmit) return null;
      const credentials: Record<string, string> = {};
      for (const spec of specs.filter(visible)) {
        const value = (values.get(spec.key) ?? "").trim();
        if (value.length > 0) credentials[spec.key] = value;
      }
      if (setup === "slackApp") {
        return { provider: channel, transport: "socket", credentials };
      }
      return { provider: channel, accountId: accountId.trim(), credentials };
    },
  };
}

function fieldState(
  spec: ChannelConnectionFieldSpec,
  entry: ChannelCatalogEntry,
  values: ReadonlyMap<string, string>,
  touched: ReadonlySet<string>,
  isRequired: boolean,
): ChannelConnectionFieldState {
  const credential = entry.credentials.find(({ key }) => key === (spec.catalogKey ?? spec.key));
  const value = values.get(spec.key) ?? "";
  return {
    key: spec.key,
    label: spec.label?.() ?? credential?.label ?? spec.key,
    help: spec.help ?? credential?.help ?? null,
    kind: spec.kind,
    choices: spec.choices?.() ?? null,
    required: isRequired,
    placeholder: spec.placeholder ?? null,
    value: spec.kind === "secret" ? null : value,
    filled: value.trim().length > 0,
    error: touched.has(spec.key) ? fieldIssue(spec, value, isRequired) : null,
  };
}

function isTaken(value: string, taken: readonly string[]): boolean {
  return taken.includes(value.trim());
}

function accountIdIssue(value: string, taken: readonly string[], label: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return i18n.t("hub.channels.connectionForm.connectionNameRequired");
  if (isTaken(trimmed, taken))
    return i18n.t("hub.channels.connectionForm.connectionNameTaken", { label });
  if (trimmed.length > 128) return i18n.t("hub.channels.connectionForm.maxLength", { max: 128 });
  return null;
}

/** Guided validation. Every rule restates one the Hub enforces server-side. */
function fieldIssue(
  spec: ChannelConnectionFieldSpec,
  raw: string,
  isRequired: boolean,
): string | null {
  const value = raw.trim();
  if (value.length === 0) return isRequired ? i18n.t("hub.channels.connectionForm.required") : null;
  if (spec.prefix !== undefined && !value.startsWith(spec.prefix)) {
    return i18n.t("hub.channels.connectionForm.prefix", { prefix: spec.prefix });
  }
  if (spec.minLength !== undefined && value.length < spec.minLength) {
    return i18n.t("hub.channels.connectionForm.minLength", { min: spec.minLength });
  }
  if (spec.maxLength !== undefined && value.length > spec.maxLength) {
    return i18n.t("hub.channels.connectionForm.maxLength", { max: spec.maxLength });
  }
  if (spec.key === "serviceAccount") return serviceAccountIssue(value);
  return null;
}

/**
 * The Hub validates the document properly (issuer endpoints, universe domain);
 * this only catches the two mistakes that are worth a round trip: pasting
 * something that is not JSON, and pasting an OAuth client instead of a service
 * account.
 */
function serviceAccountIssue(value: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return i18n.t("hub.channels.connectionForm.invalidJson");
  }
  if (parsed === null || typeof parsed !== "object")
    return i18n.t("hub.channels.connectionForm.notServiceAccount");
  const type: unknown = Reflect.get(parsed, "type");
  if (type !== "service_account") return i18n.t("hub.channels.connectionForm.serviceAccountType");
  return null;
}

export interface ChannelConnectionProblem {
  title: string;
  detail: string;
  hint: string | null;
  /** Whether trying the same credential again could succeed. */
  retryable: boolean;
}

/**
 * The Hub's answer, as guidance. `connection_unavailable` carries both halves of
 * the probe boundary: 422 is "the provider said no" (the operator's credential)
 * and 502 is "the provider did not answer" (try again). The probe message never
 * contains credential material, so it is safe to show verbatim.
 */
export function channelConnectionProblem(
  entry: ChannelCatalogEntry | undefined,
  input: { status: number; code: string; message: string },
): ChannelConnectionProblem {
  const label = entry?.label ?? i18n.t("hub.channels.problem.thisChannel");
  if (input.status === 404) {
    return {
      title: i18n.t("hub.channels.problem.notAvailableTitle", { label }),
      detail: input.message,
      hint: i18n.t("hub.channels.problem.notAvailableHint"),
      retryable: false,
    };
  }
  if (input.status === 422) {
    return {
      title: i18n.t("hub.channels.problem.rejectedTitle"),
      detail: input.message,
      hint: i18n.t("hub.channels.problem.rejectedHint"),
      retryable: false,
    };
  }
  if (input.status === 502) {
    return {
      title: i18n.t("hub.channels.problem.unreachableTitle", { label }),
      detail: input.message,
      hint: i18n.t("hub.channels.problem.unreachableHint"),
      retryable: true,
    };
  }
  if (input.status === 503) {
    return {
      title: i18n.t("hub.channels.problem.cannotVerifyTitle"),
      detail: input.message,
      hint: i18n.t("hub.channels.problem.cannotVerifyHint"),
      retryable: true,
    };
  }
  if (input.status === 409 && input.code === "connection_duplicate") {
    return {
      title: i18n.t("hub.channels.problem.duplicateTitle"),
      detail: input.message,
      hint: i18n.t("hub.channels.problem.duplicateHint"),
      retryable: false,
    };
  }
  if (input.status === 403) {
    return {
      title: i18n.t("hub.channels.problem.forbiddenTitle"),
      detail: input.message,
      hint: i18n.t("hub.channels.problem.forbiddenHint"),
      retryable: false,
    };
  }
  return {
    title: i18n.t("hub.channels.problem.refusedTitle"),
    detail: input.message,
    hint: null,
    retryable: input.status >= 500,
  };
}
