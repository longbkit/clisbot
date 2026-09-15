/**
 * The registration HTTP contract shared by the Hub server and its web entry. Kept free of server
 * imports so the browser bundle can use it.
 */

/** Refusal codes, returned as JSON `code`/`error` or as `?error=` after a Google redirect. */
export const REGISTRATION_ERROR_CODES = {
  closed: "registration_closed",
  googleEmailUnverified: "google_email_unverified",
  identityLinkedElsewhere: "account_already_linked_to_different_user",
  /** The callback finished without the Google profile Hub needs to judge the identity. */
  googleProfileUnavailable: "google_profile_unavailable",
  /** A Google claim of the first account reached an instance that someone already set up. */
  instanceUnavailable: "instance_unavailable",
  /** Better Auth's code for an abandoned link; Hub refuses to link Google to an instance operator. */
  linkRefused: "unable_to_link_account",
} as const;

export type RegistrationErrorCode =
  (typeof REGISTRATION_ERROR_CODES)[keyof typeof REGISTRATION_ERROR_CODES];

/** Refusal codes from `/api/auth/update-user` (`profile-update.ts`). */
export const PROFILE_ERROR_CODES = {
  invalidName: "invalid_profile_name",
  invalidImage: "invalid_profile_image",
} as const;

/** Refusal codes from `/api/auth/organization/update` (`organization-profile.ts`). */
export const ORGANIZATION_PROFILE_ERROR_CODES = {
  ownerRequired: "organization_owner_required",
  fieldNotEditable: "organization_field_not_editable",
  invalidName: "invalid_organization_name",
} as const;

export const EMAIL_REGISTRATION_PATHS = {
  /** `{ email }` → 202 once a link is on its way (or an account already uses the address). */
  start: "/api/auth/paseo/registration/start",
  /** `{ token }` → the link state and, while valid, its email. Never consumes the link. */
  inspect: "/api/auth/paseo/registration/inspect",
  /** `{ token, name, password }` → creates, admits, and signs in the account. */
  complete: "/api/auth/paseo/registration/complete",
} as const;

/** The query parameter a registration link carries to the Hub entry page. */
export const EMAIL_REGISTRATION_QUERY_PARAMETER = "emailRegistration";

export type RegistrationLinkStatus =
  | "valid"
  | "registered"
  | "invalid"
  | "expired"
  | "used"
  | "already_registered"
  | "registration_closed";
