import { HubDeviceOfferSchema } from "@clisbot/protocol/device-pairing-offer";
import { parseHubConfiguration } from "@/clisbot/hub/config";
import { Buffer } from "buffer";
import { i18n } from "@/i18n/i18next";

const IdentitySchema = HubDeviceOfferSchema.pick({
  hubId: true,
  publicKey: true,
});
const MAX_IDENTITY_BYTES = 8 * 1024;
export interface HubIdentityChange {
  saved: { hubId: string; publicKey: string };
  observed: { hubId: string; publicKey: string };
}

/** Diagnostic public metadata only. Observed keys are never accepted or used for authentication. */
export async function inspectHubIdentity(
  saved: { hubId: string; publicKey: string; origin?: string },
  fetchIdentity: typeof fetch = fetch,
): Promise<HubIdentityChange | null> {
  const configuration = parseHubConfiguration({ origin: saved.origin });
  if (!configuration) return null;
  try {
    const identity = IdentitySchema.safeParse(
      await fetchPublicHubIdentity(configuration.origin, fetchIdentity, 5_000),
    );
    if (!identity.success) return null;
    if (identity.data.hubId === saved.hubId && identity.data.publicKey === saved.publicKey)
      return null;
    return {
      saved: { hubId: saved.hubId, publicKey: saved.publicKey },
      observed: identity.data,
    };
  } catch {
    return null;
  }
}

/** Unauthenticated discovery only; keep the deadline active through the bounded body read. */
export async function fetchPublicHubIdentity(
  origin: string,
  fetchIdentity: typeof fetch = fetch,
  deadlineMs = 10_000,
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deadlineMs);
  try {
    const response = await fetchIdentity(new URL("/api/auth/clisbot/device/identity", origin), {
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      controller.abort();
      void response.body?.cancel().catch(() => undefined);
      throw new Error(i18n.t("hub.connection.errors.unreachable"));
    }
    return await readPublicHubIdentityResponse(response, controller);
  } catch (error) {
    if (timedOut) throw new Error(i18n.t("hub.connection.errors.timedOut"), { cause: error });
    if (error instanceof TypeError || (error instanceof Error && error.name === "AbortError"))
      throw new Error(i18n.t("hub.connection.errors.couldNotReach"), { cause: error });
    if (error instanceof SyntaxError)
      throw new Error(i18n.t("hub.connection.errors.invalidResponse"), { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** Bounded public metadata JSON; keep the caller's deadline active through this body read. */
export async function readPublicHubIdentityResponse(
  response: Response,
  controller: AbortController,
): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_IDENTITY_BYTES) {
    controller.abort();
    void response.body?.cancel().catch(() => undefined);
    throw new Error(i18n.t("hub.connection.errors.identityTooLarge"));
  }
  if (!response.body?.getReader) {
    // Native fetch implementations may expose only text, rather than a readable byte stream.
    const body = await response.text();
    if (body.length > MAX_IDENTITY_BYTES || Buffer.byteLength(body, "utf8") > MAX_IDENTITY_BYTES) {
      controller.abort();
      throw new Error(i18n.t("hub.connection.errors.identityTooLarge"));
    }
    return JSON.parse(body);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_IDENTITY_BYTES) {
        controller.abort();
        void reader.cancel().catch(() => undefined);
        throw new Error(i18n.t("hub.connection.errors.identityTooLarge"));
      }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
  } finally {
    reader.releaseLock();
  }
}
