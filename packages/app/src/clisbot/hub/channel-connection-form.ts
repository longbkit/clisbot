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
import { isConnectableChannel, type ChannelCatalogEntry } from "./channel-catalog";

export type ChannelConnectionFieldKind = "text" | "secret" | "multiline" | "choice";

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
  readonly label?: string;
  readonly help?: string;
  readonly kind: ChannelConnectionFieldKind;
  readonly choices?: readonly { value: string; label: string }[];
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
 * a bot token alone. A channel with no shape here has no operator-supplied
 * credential — Zalo Personal is linked by QR.
 */
const CONNECTION_SHAPES: Readonly<Record<string, ChannelConnectionShape>> = {
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
        label: "Domain",
        help: "Feishu is the mainland China tenant; Lark is the international one.",
        kind: "choice",
        choices: [
          { value: "feishu", label: "Feishu" },
          { value: "lark", label: "Lark" },
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
        placeholder: "/etc/paseo/googlechat.json",
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
  return entry.auth !== "qr" && CONNECTION_SHAPES[entry.id] !== undefined;
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
  choices: readonly { value: string; label: string }[] | null;
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
  /** Account name; Slack Socket Mode names its Connection from the app itself. */
  accountId: string | null;
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
  setTransport(id: string): void;
  setServiceAccountSource(source: ServiceAccountSource): void;
  setField(key: string, value: string): void;
  setSubmitting(submitting: boolean): void;
  setProblem(problem: ChannelConnectionProblem | null): void;
  /** The `POST connections` body, or null while the form cannot be submitted. */
  requestBody(): Record<string, unknown> | null;
}

export function openChannelConnectionForm(entry: ChannelCatalogEntry): ChannelConnectionFormModel {
  const channel = entry.id;
  const setup = channelSetupKind(entry);
  const specs = CONNECTION_SHAPES[channel]?.fields ?? [];
  const values = new Map<string, string>();
  const touched = new Set<string>();
  for (const spec of specs) {
    if (spec.kind === "choice") values.set(spec.key, spec.choices?.[0]?.value ?? "");
  }
  let accountId = "";
  let accountTouched = false;
  let transportId = entry.transports[0]?.id ?? null;
  let source: ServiceAccountSource | null = setup === "serviceAccount" ? "paste" : null;
  let submitting = false;
  let problem: ChannelConnectionProblem | null = null;
  let state = build();
  const listeners = new Set<() => void>();

  function visible(spec: ChannelConnectionFieldSpec): boolean {
    if (setup !== "serviceAccount") return true;
    return spec.key === (source === "file" ? "serviceAccountFile" : "serviceAccount");
  }

  function required(spec: ChannelConnectionFieldSpec): boolean {
    if (spec.required === true) return true;
    if (setup === "serviceAccount") return visible(spec);
    if (transportId === null) return false;
    return spec.requiredForTransports?.includes(transportId) === true;
  }

  function build(): ChannelConnectionFormState {
    const fields = specs
      .filter(visible)
      .map((spec) => fieldState(spec, entry, values, touched, required(spec)));
    const accountIdError =
      setup === "slackApp" || !accountTouched ? null : accountIdIssue(accountId);
    return {
      channel,
      label: entry.label,
      setup,
      accountId: setup === "slackApp" ? null : accountId,
      accountIdError,
      transports: entry.transports.map(({ id, label }) => ({ id, label })),
      transportId,
      serviceAccountSource: source,
      fields,
      submitting,
      canSubmit:
        !submitting &&
        specs
          .filter(visible)
          .every((spec) => fieldIssue(spec, values.get(spec.key) ?? "", required(spec)) === null) &&
        (setup === "slackApp" || accountIdIssue(accountId) === null),
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
    setTransport(id) {
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
    label: spec.label ?? credential?.label ?? spec.key,
    help: spec.help ?? credential?.help ?? null,
    kind: spec.kind,
    choices: spec.choices ?? null,
    required: isRequired,
    placeholder: spec.placeholder ?? null,
    value: spec.kind === "secret" ? null : value,
    filled: value.trim().length > 0,
    error: touched.has(spec.key) ? fieldIssue(spec, value, isRequired) : null,
  };
}

function accountIdIssue(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "Enter an account name.";
  if (trimmed.length > 128) return "Use 128 characters or fewer.";
  return null;
}

/** Guided validation. Every rule restates one the Hub enforces server-side. */
function fieldIssue(
  spec: ChannelConnectionFieldSpec,
  raw: string,
  isRequired: boolean,
): string | null {
  const value = raw.trim();
  if (value.length === 0) return isRequired ? "This is required." : null;
  if (spec.prefix !== undefined && !value.startsWith(spec.prefix)) {
    return `This must start with ${spec.prefix}.`;
  }
  if (spec.minLength !== undefined && value.length < spec.minLength) {
    return `Use at least ${String(spec.minLength)} characters.`;
  }
  if (spec.maxLength !== undefined && value.length > spec.maxLength) {
    return `Use ${String(spec.maxLength)} characters or fewer.`;
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
    return "This is not valid JSON.";
  }
  if (parsed === null || typeof parsed !== "object")
    return "This is not a service-account document.";
  const type: unknown = Reflect.get(parsed, "type");
  if (type !== "service_account") return 'The document\'s "type" must be "service_account".';
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
  const label = entry?.label ?? "This channel";
  if (input.status === 404) {
    return {
      title: `${label} connections are not available on this Hub`,
      detail: input.message,
      hint: "Update the Hub to a build that ships this channel.",
      retryable: false,
    };
  }
  if (input.status === 422) {
    return {
      title: "The provider rejected this credential",
      detail: input.message,
      hint: "Check the credential in the provider console, then paste it again.",
      retryable: false,
    };
  }
  if (input.status === 502) {
    return {
      title: `${label} could not be reached`,
      detail: input.message,
      hint: "The credential may be fine. Try again.",
      retryable: true,
    };
  }
  if (input.status === 503) {
    return {
      title: "The Hub cannot verify this credential right now",
      detail: input.message,
      hint: "Provider Applications are unavailable on this Hub.",
      retryable: true,
    };
  }
  if (input.status === 403) {
    return {
      title: "You cannot add Connections in this organization",
      detail: input.message,
      hint: "Ask an owner for the Hub configuration privilege.",
      retryable: false,
    };
  }
  return {
    title: "The Hub refused this request",
    detail: input.message,
    hint: null,
    retryable: input.status >= 500,
  };
}
