import { expect, it, vi } from "vitest";
import {
  ImageBudgetExceeded,
  MAX_PREPARED_IMAGE_CHARACTERS,
  prepareImagesForSend,
} from "./image-send-preparation";

it("does not decode or re-encode an already small image set", async () => {
  const images = [{ data: "small", mimeType: "image/png" }];
  const factory = vi.fn();
  expect(await prepareImagesForSend(images, factory)).toBe(images);
  expect(factory).not.toHaveBeenCalled();
});
it("keeps tiny originals while giving remaining capacity to large images; releases each encoder", async () => {
  const images = [
    { data: "small", mimeType: "image/png" },
    { data: "A".repeat(3 * 1024 * 1024), mimeType: "image/png" },
  ];
  const dispose = vi.fn();
  const encode = vi
    .fn()
    .mockResolvedValueOnce(images[1])
    .mockResolvedValueOnce({ data: "prepared", mimeType: "image/webp" });
  const factory = vi.fn(async () => ({ encode, dispose }));
  expect(await prepareImagesForSend(images, factory)).toEqual([
    images[0],
    { data: "prepared", mimeType: "image/webp" },
  ]);
  expect(factory).toHaveBeenCalledTimes(1);
  expect(encode.mock.calls[1][0].format).toBe("webp");
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(images[1].data.length).toBe(3 * 1024 * 1024);
});
it("preserves originals and frees the decoder on a real preparation failure", async () => {
  const images = [{ data: "A".repeat(MAX_PREPARED_IMAGE_CHARACTERS + 1), mimeType: "image/jpeg" }];
  const dispose = vi.fn();
  await expect(
    prepareImagesForSend(images, async () => ({
      encode: async () => {
        throw new Error("codec unavailable");
      },
      dispose,
    })),
  ).rejects.toThrow("codec unavailable");
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(images[0].data.length).toBe(MAX_PREPARED_IMAGE_CHARACTERS + 1);
});
function recordingEncoder(answer: (format: string) => { data: string; mimeType: string }) {
  const formats: string[] = [];
  return {
    formats,
    factory: async () => ({
      async encode(options: { format: string }) {
        formats.push(options.format);
        return answer(options.format);
      },
      dispose() {},
    }),
  };
}
const LARGE_PNG = { data: "P".repeat(MAX_PREPARED_IMAGE_CHARACTERS + 1), mimeType: "image/png" };

it("falls back to JPEG when the platform cannot encode WebP", async () => {
  const encoder = recordingEncoder((format) => {
    if (format === "webp") throw new Error("WebP encoder unavailable");
    if (format === "png") return LARGE_PNG;
    return { data: "jpeg copy", mimeType: "image/jpeg" };
  });
  expect(await prepareImagesForSend([LARGE_PNG], encoder.factory)).toEqual([
    { data: "jpeg copy", mimeType: "image/jpeg" },
  ]);
  expect(encoder.formats).toEqual(["png", "webp", "jpeg"]);
});

it("falls back to JPEG when a WebP request returns another format, as Safari's canvas does", async () => {
  const encoder = recordingEncoder((format) =>
    format === "jpeg" ? { data: "jpeg copy", mimeType: "image/jpeg" } : LARGE_PNG,
  );
  expect(await prepareImagesForSend([LARGE_PNG], encoder.factory)).toEqual([
    { data: "jpeg copy", mimeType: "image/jpeg" },
  ]);
  expect(encoder.formats).toEqual(["png", "webp", "jpeg"]);
});

it("reports an image that does not fit its share even at the smallest step as over budget", async () => {
  const encoder = recordingEncoder(() => ({ data: "J".repeat(1024), mimeType: "image/jpeg" }));
  await expect(
    prepareImagesForSend([{ ...LARGE_PNG, mimeType: "image/jpeg" }], encoder.factory, 10),
  ).rejects.toBeInstanceOf(ImageBudgetExceeded);
});
