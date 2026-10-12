import { isElectronRuntime } from "@/desktop/host";

/**
 * Whether the scan screen can open a camera. Browsers expose getUserMedia only in a secure
 * context (HTTPS or localhost), so a web app served over plain http on the LAN has none.
 */
export function isQrCameraAvailable(): boolean {
  if (typeof window === "undefined" || !window.isSecureContext) return false;
  return typeof navigator.mediaDevices?.getUserMedia === "function";
}

/**
 * Offer Scan QR on touch-first browsers only. The pairing QR is shown on the computer, so a
 * laptop webcam or the desktop app has nothing to point at.
 */
export function shouldOfferQrScan(): boolean {
  if (isElectronRuntime() || !isQrCameraAvailable()) return false;
  return window.matchMedia?.("(pointer: coarse)").matches === true;
}
