import { expect, it, vi } from "vitest";
const native = vi.hoisted(() => {
  const image = {
    width: 3200,
    height: 1600,
    release: vi.fn(),
    saveAsync: vi.fn(async () => ({ uri: "file:///cache/prepared.webp", base64: "prepared" })),
  };
  const context = { resize: vi.fn(), renderAsync: vi.fn(async () => image), release: vi.fn() };
  return { image, context, manipulate: vi.fn(() => context), deleteFile: vi.fn() };
});
vi.mock("expo-image-manipulator", () => ({
  ImageManipulator: { manipulate: native.manipulate },
  SaveFormat: { PNG: "png", JPEG: "jpeg", WEBP: "webp" },
}));
vi.mock("expo-file-system", () => ({
  File: class {
    delete() {
      native.deleteFile();
    }
  },
}));
// Select the native source explicitly: the browser-oriented resolver prefers .web.
const { createSendImageEncoder } =
  await vi.importActual<typeof import("./image-send-encoder")>("./image-send-encoder.ts");
it("uses the existing native encoder with matching format, bounded dimensions and resource cleanup", async () => {
  const encoder = await createSendImageEncoder({ data: "original", mimeType: "image/png" });
  expect(await encoder.encode({ maxDimension: 1600, format: "webp", quality: 0.85 })).toEqual({
    data: "prepared",
    mimeType: "image/webp",
  });
  expect(native.context.resize).toHaveBeenCalledWith({ width: 1600, height: 800 });
  expect(native.image.saveAsync).toHaveBeenCalledWith({
    format: "webp",
    compress: 0.85,
    base64: true,
  });
  expect(native.deleteFile).toHaveBeenCalledTimes(1);
  encoder.dispose();
  expect(native.context.release).toHaveBeenCalledTimes(2);
  expect(native.image.release).toHaveBeenCalledTimes(2);
});
