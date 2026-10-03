import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { getDesktopHost } from "@/desktop/host";
import { Buffer } from "buffer";
import { HubConnectionSchema, type HubConnection } from "@clisbot/protocol/device-pairing-offer";

const AUTH_PAGE = "https://app.clisbot.com/hub-google-auth.html";
export function requiresOfficialGoogleWeb(): boolean {
  return (
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    !getDesktopHost() &&
    window.location.origin !== new URL(AUTH_PAGE).origin
  );
}
export function officialHubConnectionUrl(connection: HubConnection): string {
  const publicTarget = HubConnectionSchema.parse(connection);
  const encoded = Buffer.from(JSON.stringify(publicTarget))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `https://app.clisbot.com/settings/hub/hubs#hub=${encoded}`;
}
export function parsePublicHubConnection(encoded: string): HubConnection {
  if (encoded.length > 16_384 || !/^[A-Za-z0-9_-]+$/.test(encoded))
    throw new Error("Invalid Hub connection link");
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  return HubConnectionSchema.parse(JSON.parse(Buffer.from(base64, "base64").toString("utf8")));
}
export function openOfficialHubGoogle(connection: HubConnection): void {
  const opened = window.open(officialHubConnectionUrl(connection), "_blank", "noopener,noreferrer");
  // Browsers may return null with noopener even when opening succeeds.
  void opened;
}
export interface GoogleTokenInput {
  clientId: string;
  nonce: string;
  transactionId: string;
}
export function prepareGooglePopup(): Window | undefined {
  if (Platform.OS !== "web" || getDesktopHost()) return undefined;
  const popup = window.open("about:blank", "clisbot-google-sign-in", "popup,width=520,height=680");
  if (!popup) throw new Error("Allow popups to continue with Google");
  return popup;
}
export async function acquireGoogleIdToken(
  input: GoogleTokenInput,
  preparedPopup?: Window,
): Promise<string> {
  const desktop = getDesktopHost();
  if (desktop?.google?.signIn) {
    const result = await desktop.google.signIn(input);
    if (result.transactionId !== input.transactionId || !result.idToken)
      throw new Error("Google sign-in handoff did not match this request");
    return result.idToken;
  }
  const auth = new URL(AUTH_PAGE);
  const parameters = new URLSearchParams({ ...input });
  if (Platform.OS === "web") {
    parameters.set("mode", "popup");
    parameters.set("returnOrigin", window.location.origin);
    auth.hash = parameters.toString();
    const popup =
      preparedPopup ??
      window.open(auth.href, "clisbot-google-sign-in", "popup,width=520,height=680");
    if (!popup) throw new Error("Allow popups to continue with Google");
    if (preparedPopup) preparedPopup.location.href = auth.href;
    return await new Promise<string>((resolve, reject) => {
      const finish = (token?: string, error?: string) => {
        clearTimeout(timeout);
        clearInterval(closed);
        window.removeEventListener("message", message);
        popup.close();
        if (token) resolve(token);
        else reject(new Error(error ?? "Google sign-in cancelled"));
      };
      const message = (event: MessageEvent) => {
        if (
          event.source !== popup ||
          event.origin !== auth.origin ||
          event.data?.type !== "clisbot.google.id-token" ||
          event.data?.transactionId !== input.transactionId
        )
          return;
        finish(
          typeof event.data.idToken === "string" ? event.data.idToken : undefined,
          event.data.error,
        );
      };
      const timeout = setTimeout(
        () => finish(undefined, "Google sign-in expired; try again"),
        5 * 60_000,
      );
      const closed = setInterval(() => {
        if (popup.closed) finish();
      }, 500);
      window.addEventListener("message", message);
    });
  }
  const redirectUri = Linking.createURL("hub-google");
  parameters.set("mode", "redirect");
  parameters.set("redirectUri", redirectUri);
  auth.hash = parameters.toString();
  const result = await WebBrowser.openAuthSessionAsync(auth.href, redirectUri);
  if (result.type !== "success") throw new Error("Google sign-in cancelled");
  const callback = new URL(result.url);
  const expected = new URL(redirectUri);
  if (
    callback.protocol !== expected.protocol ||
    callback.host !== expected.host ||
    callback.pathname !== expected.pathname
  )
    throw new Error("Google sign-in returned to an unexpected app route");
  const response = new URLSearchParams(callback.hash.slice(1));
  if (response.get("transactionId") !== input.transactionId || !response.get("idToken"))
    throw new Error("Google sign-in handoff did not match this request");
  return response.get("idToken")!;
}
