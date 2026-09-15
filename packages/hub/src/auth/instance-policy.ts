import { z } from "zod";

export const REGISTRATION_MODES = [
  "open",
  "invite_only",
  "domain_self_registration",
  "disabled",
] as const;
export const ORGANIZATION_CREATION_MODES = ["open", "disabled"] as const;
export const PASSWORD_MIN_LENGTH = 12;

export type RegistrationMode = (typeof REGISTRATION_MODES)[number];
export type OrganizationCreationMode = (typeof ORGANIZATION_CREATION_MODES)[number];

export interface BootstrapSettings {
  organizationName: string;
  ownerEmail: string;
  ownerPassword: string | undefined;
}

export interface InstanceAuthPolicy {
  registrationMode: RegistrationMode;
  organizationCreation: OrganizationCreationMode;
  bootstrap: BootstrapSettings | undefined;
  /** Exact, lower-cased email domains admitted by `domain_self_registration`. Ignored by every
   * other mode; absent means no domain is allowlisted. */
  allowedDomains?: readonly string[];
}

const registrationModeSchema = z.enum(REGISTRATION_MODES);
const organizationCreationSchema = z.enum(ORGANIZATION_CREATION_MODES);
const bootstrapPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, "PASEO_BOOTSTRAP_OWNER_PASSWORD must be at least 12 characters")
  .max(128, "PASEO_BOOTSTRAP_OWNER_PASSWORD must not exceed 128 characters")
  .refine((value) => value.trim().length > 0, "PASEO_BOOTSTRAP_OWNER_PASSWORD must not be blank")
  .refine(
    (value) =>
      (() => {
        for (const character of value) {
          const code = character.codePointAt(0) ?? 0;
          if (code < 32 || code === 127) return false;
        }
        return true;
      })(),
    "PASEO_BOOTSTRAP_OWNER_PASSWORD must not contain control characters",
  );

export function defaultInstanceAuthPolicy(): InstanceAuthPolicy {
  return {
    registrationMode: "invite_only",
    organizationCreation: "disabled",
    bootstrap: undefined,
  };
}

export function readInstanceAuthPolicy(
  environment: Record<string, string | undefined>,
): InstanceAuthPolicy {
  const registrationMode = parsePolicyValue(
    "PASEO_REGISTRATION_MODE",
    environment["PASEO_REGISTRATION_MODE"],
    registrationModeSchema,
    REGISTRATION_MODES,
    "invite_only",
  );
  const organizationCreation = parsePolicyValue(
    "PASEO_ORGANIZATION_CREATION",
    environment["PASEO_ORGANIZATION_CREATION"],
    organizationCreationSchema,
    ORGANIZATION_CREATION_MODES,
    "disabled",
  );
  const allowedDomains = readAllowedDomains(
    registrationMode,
    environment["PASEO_REGISTRATION_ALLOWED_DOMAINS"],
  );
  const organizationName = environment["PASEO_BOOTSTRAP_ORGANIZATION"]?.trim() ?? "";
  const ownerEmail = environment["PASEO_BOOTSTRAP_OWNER_EMAIL"]?.trim() ?? "";
  const ownerPassword = environment["PASEO_BOOTSTRAP_OWNER_PASSWORD"] ?? "";
  const suppliedBootstrapFields = [organizationName, ownerEmail, ownerPassword].filter(
    (value) => value.length > 0,
  ).length;

  if (suppliedBootstrapFields === 0) {
    return { registrationMode, organizationCreation, bootstrap: undefined, allowedDomains };
  }
  if (suppliedBootstrapFields === 2 && ownerPassword.length === 0) {
    validateBootstrapIdentity(organizationName, ownerEmail);
    return {
      registrationMode,
      organizationCreation,
      allowedDomains,
      bootstrap: {
        organizationName,
        ownerEmail: normalizeEmail(ownerEmail),
        ownerPassword: undefined,
      },
    };
  }
  if (suppliedBootstrapFields !== 3) {
    throw new Error(
      "PASEO_BOOTSTRAP_ORGANIZATION, PASEO_BOOTSTRAP_OWNER_EMAIL, and PASEO_BOOTSTRAP_OWNER_PASSWORD must be supplied together",
    );
  }

  validateBootstrapIdentity(organizationName, ownerEmail);
  bootstrapPasswordSchema.parse(ownerPassword);
  if (normalizeEmail(ownerPassword) === normalizeEmail(ownerEmail)) {
    throw new Error("PASEO_BOOTSTRAP_OWNER_PASSWORD must not equal the owner email");
  }

  return {
    registrationMode,
    organizationCreation,
    allowedDomains,
    bootstrap: {
      organizationName,
      ownerEmail: normalizeEmail(ownerEmail),
      ownerPassword,
    },
  };
}

const DOMAIN_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;

/** Consumer mailbox providers. Anyone can hold an address there, so owning one proves nothing
 * about belonging to an organization; such users are admitted only by invitation. */
const PUBLIC_EMAIL_DOMAINS = new Set([
  "aol.com",
  "gmail.com",
  "gmx.com",
  "gmx.net",
  "googlemail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mac.com",
  "mail.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "qq.com",
  "yahoo.com",
  "yandex.com",
  "zoho.com",
]);

function readAllowedDomains(
  registrationMode: RegistrationMode,
  value: string | undefined,
): readonly string[] {
  const domains = [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((domain) => domain.trim().toLowerCase())
        .filter((domain) => domain.length > 0),
    ),
  ];
  for (const domain of domains) {
    if (!DOMAIN_PATTERN.test(domain)) {
      throw new Error(`PASEO_REGISTRATION_ALLOWED_DOMAINS contains an invalid domain: ${domain}`);
    }
    if (PUBLIC_EMAIL_DOMAINS.has(domain)) {
      throw new Error(
        `PASEO_REGISTRATION_ALLOWED_DOMAINS must not contain a public email domain: ${domain}`,
      );
    }
  }
  if (registrationMode === "domain_self_registration" && domains.length === 0) {
    throw new Error(
      "PASEO_REGISTRATION_ALLOWED_DOMAINS must list at least one domain when PASEO_REGISTRATION_MODE is domain_self_registration",
    );
  }
  return domains;
}

/** The domain an admission decision matches on: everything after the last `@`, lower-cased. */
export function emailDomain(email: string): string {
  const normalized = normalizeEmail(email);
  return normalized.slice(normalized.lastIndexOf("@") + 1);
}

function validateBootstrapIdentity(organizationName: string, ownerEmail: string): void {
  const parsedEmail = z.string().email().safeParse(ownerEmail);
  if (!parsedEmail.success) throw new Error("PASEO_BOOTSTRAP_OWNER_EMAIL must be a valid email");
  if (organizationName.length > 100) {
    throw new Error("PASEO_BOOTSTRAP_ORGANIZATION must not exceed 100 characters");
  }
}

function parsePolicyValue<T extends string>(
  name: string,
  value: string | undefined,
  schema: z.ZodType<T>,
  allowed: readonly T[],
  fallback: T,
): T {
  const result = schema.safeParse(value ?? fallback);
  if (result.success) return result.data;
  throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
