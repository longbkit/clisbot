import { z } from "zod";

export const REGISTRATION_MODES = ["open", "invite_only", "disabled"] as const;
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
  const organizationName = environment["PASEO_BOOTSTRAP_ORGANIZATION"]?.trim() ?? "";
  const ownerEmail = environment["PASEO_BOOTSTRAP_OWNER_EMAIL"]?.trim() ?? "";
  const ownerPassword = environment["PASEO_BOOTSTRAP_OWNER_PASSWORD"] ?? "";
  const suppliedBootstrapFields = [organizationName, ownerEmail, ownerPassword].filter(
    (value) => value.length > 0,
  ).length;

  if (suppliedBootstrapFields === 0) {
    return { registrationMode, organizationCreation, bootstrap: undefined };
  }
  if (suppliedBootstrapFields === 2 && ownerPassword.length === 0) {
    validateBootstrapIdentity(organizationName, ownerEmail);
    return {
      registrationMode,
      organizationCreation,
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
    bootstrap: {
      organizationName,
      ownerEmail: normalizeEmail(ownerEmail),
      ownerPassword,
    },
  };
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
