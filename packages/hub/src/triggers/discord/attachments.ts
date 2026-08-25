import type {
  AttachmentResolver,
  AttachmentResolverInput,
} from "../../attachments/capabilities.js";

const DISCORD_ATTACHMENT_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const DISCORD_ATTACHMENT_TIMEOUT_MS = 10_000;

export function createDiscordAttachmentResolver(
  options: {
    fetch?: typeof fetch;
    requestTimeoutMs?: number;
  } = {},
): AttachmentResolver {
  const request = options.fetch ?? fetch;
  return async (input) => {
    const url = readDiscordAttachmentUrl(input);
    return request(url, {
      method: "GET",
      signal: AbortSignal.timeout(options.requestTimeoutMs ?? DISCORD_ATTACHMENT_TIMEOUT_MS),
    });
  };
}

function readDiscordAttachmentUrl(input: AttachmentResolverInput): URL {
  if (!isRecord(input.locator)) {
    throw new Error("invalid Discord attachment locator");
  }
  const value = input.locator["url"];
  if (typeof value !== "string") throw new Error("invalid Discord attachment locator");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    !DISCORD_ATTACHMENT_HOSTS.has(url.hostname) ||
    !url.pathname.startsWith("/attachments/")
  ) {
    throw new Error("invalid Discord attachment URL");
  }
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
