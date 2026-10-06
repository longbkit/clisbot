// upstream: src/media/qr-image.ts@5d8067a4483
// QR image helpers generate QR code image files for media delivery.
// D-CORE-703: `writeQrPngTempFile` (with its temp-path types and segment guard) is not
// carried: it writes through `@openclaw/fs-safe`'s private temp workspace, and the
// one ported caller (the WhatsApp QR login) only needs the PNG data URL. The
// renderers below are upstream's, verbatim.
import { loadQrCodeRuntime } from "./qr-runtime.js";

const DEFAULT_QR_PNG_SCALE = 6;
const DEFAULT_QR_PNG_MARGIN_MODULES = 4;
const MIN_QR_PNG_SCALE = 1;
const MAX_QR_PNG_SCALE = 12;
const MIN_QR_PNG_MARGIN_MODULES = 0;
const MAX_QR_PNG_MARGIN_MODULES = 16;
const QR_PNG_DATA_URL_PREFIX = "data:image/png;base64,";

type QrPngRenderOptions = {
  scale?: number;
  marginModules?: number;
};

function resolveQrPngIntegerOption(params: {
  name: string;
  value: number | undefined;
  defaultValue: number;
  min: number;
  max: number;
}): number {
  if (params.value === undefined) {
    return params.defaultValue;
  }
  if (!Number.isFinite(params.value)) {
    throw new RangeError(`${params.name} must be a finite number.`);
  }
  const value = Math.floor(params.value);
  if (value < params.min || value > params.max) {
    throw new RangeError(`${params.name} must be between ${params.min} and ${params.max}.`);
  }
  return value;
}

async function renderQrPngBuffer(input: string, opts: QrPngRenderOptions): Promise<Buffer> {
  const scale = resolveQrPngIntegerOption({
    name: "scale",
    value: opts.scale,
    defaultValue: DEFAULT_QR_PNG_SCALE,
    min: MIN_QR_PNG_SCALE,
    max: MAX_QR_PNG_SCALE,
  });
  const marginModules = resolveQrPngIntegerOption({
    name: "marginModules",
    value: opts.marginModules,
    defaultValue: DEFAULT_QR_PNG_MARGIN_MODULES,
    min: MIN_QR_PNG_MARGIN_MODULES,
    max: MAX_QR_PNG_MARGIN_MODULES,
  });
  const qrCode = await loadQrCodeRuntime();
  return await qrCode.toBuffer(input, {
    margin: marginModules,
    scale,
  });
}

/** Renders QR text as raw PNG base64 after validating bounded renderer options. */
export async function renderQrPngBase64(
  input: string,
  opts: QrPngRenderOptions = {},
): Promise<string> {
  return (await renderQrPngBuffer(input, opts)).toString("base64");
}

/** Renders QR text as a PNG data URL. */
export async function renderQrPngDataUrl(
  input: string,
  opts: QrPngRenderOptions = {},
): Promise<string> {
  return `${QR_PNG_DATA_URL_PREFIX}${await renderQrPngBase64(input, opts)}`;
}
