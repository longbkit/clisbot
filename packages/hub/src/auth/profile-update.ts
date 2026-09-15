import { isIP } from "node:net";
import { APIError } from "better-call";
import { PROFILE_ERROR_CODES } from "./registration-contract.js";

/** Better Auth's own endpoint for a signed-in user's name and image. */
export const UPDATE_USER_PATH = "/api/auth/update-user";

const NAME_MAX_LENGTH = 100;
const IMAGE_URL_MAX_LENGTH = 2048;

/** Hosts whose profile images Hub accepts when the operator configures none. Each entry also
 * admits its subdomains (`googleusercontent.com` admits `lh3.googleusercontent.com`). */
export const DEFAULT_PROFILE_IMAGE_HOSTS = [
  "googleusercontent.com",
  "gravatar.com",
  "githubusercontent.com",
] as const;

/**
 * Profile images are URLs Hub never fetches, but every app and daemon that renders the account
 * does, so an arbitrary URL would let its owner see who looks at the account. Operators choose the
 * image hosts they trust with `PASEO_PROFILE_IMAGE_HOSTS` (comma-separated).
 */
export function readProfileImageHosts(
  environment: Record<string, string | undefined>,
): readonly string[] {
  const configured = (environment["PASEO_PROFILE_IMAGE_HOSTS"] ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
  return configured.length === 0 ? DEFAULT_PROFILE_IMAGE_HOSTS : configured;
}

interface UserUpdate {
  name?: unknown;
  image?: unknown;
}

interface HookContext {
  path?: string;
}

/**
 * `user.update.before` for Better Auth's `/update-user`: the only user-driven profile write. Other
 * updates (email verification, account linking) are Better Auth's own and pass through untouched.
 */
export function profileUpdateHook(imageHosts: readonly string[]) {
  return async (user: UserUpdate, context: unknown) => {
    if ((context as HookContext | null | undefined)?.path !== "/update-user") return undefined;
    const data: { name?: string; image?: string | null } = {};
    if (user.name !== undefined) data.name = profileName(user.name);
    if (user.image !== undefined) data.image = profileImage(user.image, imageHosts);
    return { data };
  };
}

function profileName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length === 0 || name.length > NAME_MAX_LENGTH || hasControlCharacter(name)) {
    throw rejection(PROFILE_ERROR_CODES.invalidName);
  }
  return name;
}

/** An image is cleared with `null` or an empty string, or set to an https URL on a trusted host. */
function profileImage(value: unknown, imageHosts: readonly string[]): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > IMAGE_URL_MAX_LENGTH) {
    throw rejection(PROFILE_ERROR_CODES.invalidImage);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw rejection(PROFILE_ERROR_CODES.invalidImage);
  }
  const host = url.hostname.toLowerCase();
  const trusted = imageHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    isIP(host.replace(/^\[|\]$/gu, "")) !== 0 ||
    !trusted
  ) {
    throw rejection(PROFILE_ERROR_CODES.invalidImage);
  }
  return url.toString();
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function rejection(code: string): APIError {
  return new APIError("BAD_REQUEST", { message: code, code });
}
