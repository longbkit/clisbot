// upstream: src/media/qr-runtime.ts@5d8067a4483
// QR runtime helpers lazily load QR code generation.
import type QRCode from "qrcode";
import { createLazyImportLoader } from "../shared/lazy-promise.js";

type QrCodeRuntime = typeof QRCode;

const qrCodeRuntimeLoader = createLazyImportLoader<QrCodeRuntime>(() =>
  import("qrcode").then((mod) => mod.default ?? mod),
);

/** Loads the qrcode package lazily so QR support does not affect media startup paths. */
export async function loadQrCodeRuntime(): Promise<QrCodeRuntime> {
  return await qrCodeRuntimeLoader.load();
}
