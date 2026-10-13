import { z } from "zod";
const TelegramIdentity = z.object({
  ok: z.literal(true),
  result: z.object({ username: z.string().regex(/^[A-Za-z0-9_]{5,32}$/) }),
});
/** A read-only identity lookup. Never include a token-bearing URL or provider error in output. */
export async function telegramOwnerDestination(
  token: string,
  apiRoot = "https://api.telegram.org",
  request: typeof fetch = fetch,
): Promise<string | undefined> {
  try {
    const response = await request(
      `${apiRoot.replace(/\/$/, "")}/bot${encodeURIComponent(token)}/getMe`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!response.ok) return undefined;
    const parsed = TelegramIdentity.safeParse(await response.json());
    return parsed.success ? `https://t.me/${parsed.data.result.username}` : undefined;
  } catch {
    return undefined;
  }
}
