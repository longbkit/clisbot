// Fusion-owned boundary for `src/infra/errors.ts`.
//
// Upstream's `src/logging/redact.ts` is a ~1300-line module wired to
// `OpenClawConfig` logging settings, a global secret registry, the net-policy
// package and ACP structured-auth redaction. None of that closure is portable
// into Fusion, so this module keeps only the contract `infra/errors.ts`
// depends on: turn a message into a message with obvious credentials masked.
// Manifest: packages/channels/core/upstream-sync.json D-CORE-002.

const MASK = "[redacted]";

// Ordered widest-first so a bot token inside a URL is masked as a whole.
const SENSITIVE_PATTERNS: RegExp[] = [
  // Telegram Bot API path segment: /bot<digits>:<base64url>. The colon is
  // matched percent-encoded too: the Fusion media transport builds its Bot API
  // URLs with `encodeURIComponent(botToken)`, so a URL that reaches an error
  // message carries `/bot<digits>%3A<base64url>` and the literal-colon pattern
  // alone would walk straight past a live token.
  /\/bot\d{5,}(?::|%3[Aa])[A-Za-z0-9_-]{20,}/g,
  // Bare Telegram bot token, in either spelling.
  /\b\d{5,}(?::|%3[Aa])[A-Za-z0-9_-]{30,}\b/g,
  // Slack tokens (xoxb-, xoxp-, xapp-, xoxe-) and Slack signing secrets.
  /\bxox[abepors]-[A-Za-z0-9-]{10,}/g,
  // A PEM private key block — the Google Chat service-account credential. The
  // whole body goes, header line included, because a partial key is still a
  // key.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Discord bot credential. Discord's scheme word is `Bot`, not `Bearer`, so
  // the bearer pattern below never saw it.
  /(\bBot\s+)[A-Za-z0-9._-]{20,}/g,
  // Authorization headers and bearer tokens. The scheme word is kept so a
  // reflected `Authorization: Bearer …` still reads as an auth header; only the
  // credential is masked (upstream's redactor draws the line the same way).
  /(\b[Bb]earer\s+)[A-Za-z0-9._~+/-]{10,}=*/g,
  // A Feishu/Lark app secret rides beside its `cli_`-prefixed app id in the
  // tenant-token request body, so mask both halves of that pair.
  /\bcli_[A-Za-z0-9]{10,}/g,
  // The Zalo Bot API carries its token as a PATH segment, not a query
  // parameter: `…/bot<token>/getMe`. Anchored on the segment boundary so an
  // ordinary word starting with "bot" is untouched.
  /(\/bot)[A-Za-z0-9_:-]{20,}(?=\/|$)/g,
  // Sensitive URL query parameters.
  /([?&](?:token|access_token|api_key|apikey|key|secret|signature|sig|password)=)[^&\s"']+/gi,
];

/** Masks credentials that routinely reach error messages and logs. */
export function redactSensitiveText(text: string): string {
  if (!text) {
    return text;
  }
  let redacted = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, (match, prefix) =>
      typeof prefix === "string" ? `${prefix}${MASK}` : MASK,
    );
  }
  return redacted;
}

// Structured-field key redaction (Discord vertical port, slice 13).
//
// Upstream's `redactSensitiveFieldValue` resolves the caller's logging config,
// the registered-secret table and the structured-auth policy before masking.
// Fusion's Hub owns logging config (D-CORE-002), so this keeps the observable
// contract the ported Discord REST error redactor depends on: a sensitive field
// key masks its whole value (an empty value still returns the mask, which is how
// callers probe key sensitivity), any other key gets the text redactor above.
// The key patterns are upstream's `STRUCTURED_SECRET_FIELD_RE` and
// `STRUCTURED_SECRET_ENV_FIELD_RE`, minus the payment-credential key lists.
const STRUCTURED_SECRET_FIELD_RE =
  /^(?:api[-_]?key|apiKey|api[-_]?token|apiToken|bearer[-_]?token|bearerToken|token|secret|password|passwd|credential|authorization|private[-_]?key|privateKey|access[-_]?token|accessToken|refresh[-_]?token|refreshToken|id[-_]?token|idToken|auth[-_]?token|authToken|client[-_]?secret|clientSecret|app[-_]?secret|appSecret|secret[-_]?value|secretValue|raw[-_]?secret|rawSecret|secret[-_]?input|secretInput|key|key[-_]?material|keyMaterial|jwt|session|signature|cookie|set[-_]?cookie|bot[-_]?token|botToken|app[-_]?token|appToken|tenant[-_]?access[-_]?token|tenantAccessToken|encrypt[-_]?key|encryptKey|verification[-_]?token|verificationToken|signing[-_]?secret|signingSecret|service[-_]?account|serviceAccount|imei|cookies?)$/i;
const STRUCTURED_SECRET_ENV_FIELD_RE =
  /^(?:(?:[A-Z0-9]+[_-])+(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)|API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD)$/i;

/** True when a structured payload key names a credential-bearing field. */
export function isSensitiveFieldKey(key: string): boolean {
  return STRUCTURED_SECRET_FIELD_RE.test(key) || STRUCTURED_SECRET_ENV_FIELD_RE.test(key);
}

/** Masks a structured payload value, keyed on the field name it arrived under. */
export function redactSensitiveFieldValue(key: string, value: string): string {
  if (isSensitiveFieldKey(key)) {
    return MASK;
  }
  return redactSensitiveText(value);
}
