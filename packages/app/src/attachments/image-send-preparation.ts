export interface SendImage {
  data: string;
  mimeType: string;
}
export interface ImageEncodingOptions {
  maxDimension: number;
  format: "png" | "jpeg" | "webp";
  quality: number;
}
export interface SendImageEncoder {
  encode(options: ImageEncodingOptions): Promise<SendImage>;
  dispose(): void;
}

// Leaves headroom in existing Hosts' 16 MiB file-operation budget, including
// their base64 snapshot/decode cost. Also fits one Chat row and relay frame.
export const MAX_PREPARED_IMAGE_CHARACTERS = 2 * 1024 * 1024;
const ENCODING_STEPS: readonly ImageEncodingOptions[] = [
  { maxDimension: 2560, format: "png", quality: 1 },
  { maxDimension: 2560, format: "jpeg", quality: 0.85 },
  { maxDimension: 2048, format: "jpeg", quality: 0.8 },
  { maxDimension: 1600, format: "jpeg", quality: 0.75 },
  { maxDimension: 1280, format: "jpeg", quality: 0.7 },
  { maxDimension: 1024, format: "jpeg", quality: 0.65 },
  { maxDimension: 768, format: "jpeg", quality: 0.6 },
  { maxDimension: 512, format: "jpeg", quality: 0.6 },
  { maxDimension: 256, format: "jpeg", quality: 0.6 },
];

/** No encoding step fits this image into its share; fewer images per message would. */
export class ImageBudgetExceeded extends Error {
  constructor() {
    super("These images do not fit in one message.");
    this.name = "ImageBudgetExceeded";
  }
}

/** Prepare a send copy only. Persisted originals and draft identity are untouched. */
export async function prepareImagesForSend(
  images: SendImage[],
  createEncoder: (image: SendImage) => Promise<SendImageEncoder>,
  budget = MAX_PREPARED_IMAGE_CHARACTERS,
): Promise<SendImage[]> {
  const total = images.reduce((sum, image) => sum + image.data.length, 0);
  if (total <= budget) return images;
  const equalShare = Math.floor(budget / images.length);
  const unchanged = images.filter((image) => image.data.length <= equalShare);
  const remaining = budget - unchanged.reduce((sum, image) => sum + image.data.length, 0);
  const largeTotal = total - unchanged.reduce((sum, image) => sum + image.data.length, 0);
  const prepared: SendImage[] = [];
  for (const image of images) {
    if (image.data.length <= equalShare) {
      prepared.push(image);
      continue;
    }
    const allowance = Math.floor((image.data.length / largeTotal) * remaining);
    const encoder = await createEncoder(image);
    try {
      prepared.push(await encodeWithin(encoder, image, allowance));
    } finally {
      encoder.dispose();
    }
  }
  return prepared;
}

/**
 * The first step that fits. Images other than JPEG keep their transparency as WebP; where the
 * platform cannot write WebP (it throws, or returns another format as Safari's canvas does),
 * JPEG takes over for this and every smaller step.
 */
async function encodeWithin(
  encoder: SendImageEncoder,
  image: SendImage,
  allowance: number,
): Promise<SendImage> {
  let lossy: "webp" | "jpeg" = image.mimeType === "image/jpeg" ? "jpeg" : "webp";
  for (const step of ENCODING_STEPS) {
    let encoded: SendImage | null = null;
    if (step.format === "jpeg" && lossy === "webp") {
      encoded = await encoder.encode({ ...step, format: "webp" }).catch(() => null);
      if (encoded?.mimeType !== "image/webp") {
        lossy = "jpeg";
        encoded = null;
      }
    }
    encoded ??= await encoder.encode(step);
    if (encoded.data.length <= allowance) return encoded;
  }
  throw new ImageBudgetExceeded();
}
