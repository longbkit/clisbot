import { isFdroidBuild } from "@/constants/build-profile";

// Native: the camera module ships in every build except F-Droid, which stubs it out.

/** Whether the scan screen can open a camera. */
export function isQrCameraAvailable(): boolean {
  return !isFdroidBuild;
}

/** Whether to offer Scan QR among the ways to connect. */
export function shouldOfferQrScan(): boolean {
  return !isFdroidBuild;
}
