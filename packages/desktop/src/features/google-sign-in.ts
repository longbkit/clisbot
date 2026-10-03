import { ipcMain, shell } from "electron";
import { requireTrustedRenderer } from "./hub-client.js";
import {
  GoogleSignInInputSchema,
  googleSignInUrl,
  openGoogleAuthCallback,
} from "./google-auth-callback.js";

/** System browser only; the renderer never chooses an arbitrary authentication URL. */
export function registerGoogleSignInHandlers(): void {
  let active = false;
  ipcMain.handle("clisbot:google:sign-in", async (event, raw: unknown) => {
    requireTrustedRenderer(event);
    if (active) throw new Error("Google sign-in is already open");
    const input = GoogleSignInInputSchema.parse(raw);
    active = true;
    const callback = await openGoogleAuthCallback(input.transactionId).catch((error) => {
      active = false;
      throw error;
    });
    try {
      await shell.openExternal(googleSignInUrl(input, callback.redirectUri));
      return await callback.result;
    } finally {
      callback.close();
      active = false;
    }
  });
}
