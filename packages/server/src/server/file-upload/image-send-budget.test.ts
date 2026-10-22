import { afterEach, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachSessionFiles } from "./session-files.js";
import { sessionFileActivityUsage } from "./session-file-activity.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});
it("saves three automatically prepared images within the compatible aggregate budget without changing bytes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "image-budget-"));
  roots.push(directory);
  const originals = [0, 1, 2].map((value) => Buffer.alloc(512 * 1024 - 3, value));
  const images = originals.map((bytes) => ({
    data: bytes.toString("base64"),
    mimeType: "image/png",
  }));
  expect(images.reduce((sum, image) => sum + image.data.length, 0)).toBeLessThanOrEqual(
    2 * 1024 * 1024,
  );
  const input = { directory, messageId: "three-pasted-images", images, ownsUpload: () => false };
  const result = await attachSessionFiles(input);
  expect(result.images).toEqual(images);
  for (const [index, file] of result.links.files.entries()) {
    expect(await fs.readFile(path.join(directory, file.relativePath))).toEqual(originals[index]);
  }
  expect(await attachSessionFiles(input)).toEqual(result);
  expect(sessionFileActivityUsage().operations).toBe(0);
});
