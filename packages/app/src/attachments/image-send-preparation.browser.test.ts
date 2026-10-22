import { afterEach, expect, it } from "vitest";
import { createIndexedDbAttachmentStore } from "./web/indexeddb-attachment-store";
import { __setAttachmentStoreForTests } from "./store";
import { encodeAttachmentsForSend } from "./service";
import { MAX_PREPARED_IMAGE_CHARACTERS } from "./image-send-preparation";

function screenshot(seed: number): Blob {
  const canvas = document.createElement("canvas");
  canvas.width = 2200;
  canvas.height = 2000;
  const context = canvas.getContext("2d")!;
  const pixels = context.createImageData(canvas.width, canvas.height);
  let value = seed;
  for (let index = 0; index < pixels.data.length; index += 4) {
    value = (value * 1664525 + 1013904223) >>> 0;
    pixels.data[index] = value & 255;
    pixels.data[index + 1] = (value >>> 8) & 255;
    pixels.data[index + 2] = (value >>> 16) & 255;
    pixels.data[index + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  context.fillStyle = "white";
  context.fillRect(0, 0, 1600, 100);
  context.fillStyle = "black";
  context.font = "40px sans-serif";
  context.fillText(`Image ${seed}: preserve text and every attachment`, 20, 65);
  return new Blob(
    [Uint8Array.from(atob(canvas.toDataURL("image/png").split(",")[1]), (c) => c.charCodeAt(0))],
    { type: "image/png" },
  );
}

afterEach(() => __setAttachmentStoreForTests(null));
it("automatically prepares three large pasted images and retains originals across retries", async () => {
  const store = createIndexedDbAttachmentStore();
  __setAttachmentStoreForTests(store);
  const originals = await Promise.all(
    [1, 2, 3].map((seed) =>
      store.save({
        id: `image-budget-${seed}`,
        source: { kind: "blob", blob: screenshot(seed) },
        mimeType: "image/png",
      }),
    ),
  );
  try {
    const before = await Promise.all(
      originals.map((attachment) => store.encodeBase64({ attachment })),
    );
    expect(originals.reduce((sum, value) => sum + (value.byteSize ?? 0), 0)).toBeGreaterThan(
      32 * 1024 * 1024,
    );
    // Understated metadata must not starve this image of its output share.
    originals[0].byteSize = 1;
    const sent = (await encodeAttachmentsForSend(originals))!;
    expect(sent).toHaveLength(3);
    expect(sent.reduce((sum, image) => sum + image.data.length, 0)).toBeLessThanOrEqual(
      MAX_PREPARED_IMAGE_CHARACTERS,
    );
    for (const image of sent) {
      const decoded = new Image();
      decoded.src = `data:${image.mimeType};base64,${image.data}`;
      await decoded.decode();
      expect(decoded.naturalWidth).toBeGreaterThanOrEqual(1024);
    }
    expect(await encodeAttachmentsForSend(originals)).toEqual(sent);
    expect(
      await Promise.all(originals.map((attachment) => store.encodeBase64({ attachment }))),
    ).toEqual(before);
  } finally {
    await Promise.all(originals.map((attachment) => store.delete({ attachment })));
  }
}, 30000);

it("preserves transparent text pixels when preparing WebP and reports the actual MIME", async () => {
  const { createSendImageEncoder } = await import("./image-send-encoder.web");
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 400;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "black";
  context.fillRect(100, 100, 100, 100);
  context.font = "40px sans-serif";
  context.fillText("Transparent screenshot: text stays visible", 20, 300);
  const encoder = await createSendImageEncoder({
    data: canvas.toDataURL().split(",")[1],
    mimeType: "image/png",
  });
  try {
    const result = await encoder.encode({ maxDimension: 1200, format: "webp", quality: 0.85 });
    const decoded = new Image();
    decoded.src = `data:${result.mimeType};base64,${result.data}`;
    await decoded.decode();
    context.clearRect(0, 0, 1200, 400);
    context.drawImage(decoded, 0, 0);
    expect(context.getImageData(0, 0, 1, 1).data[3]).toBe(0);
    expect(context.getImageData(150, 150, 1, 1).data[3]).toBe(255);
    expect(context.getImageData(150, 150, 1, 1).data[0]).toBeLessThan(10);
    expect(result.mimeType).toBe("image/webp");
  } finally {
    encoder.dispose();
  }
});
