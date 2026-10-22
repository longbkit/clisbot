import { expect, it, vi } from "vitest";
import { MAX_PREPARED_IMAGE_CHARACTERS, prepareImagesForSend } from "./image-send-preparation";

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
