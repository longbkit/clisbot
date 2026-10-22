import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { SendImage, SendImageEncoder } from "./image-send-preparation";

export async function createSendImageEncoder(image: SendImage): Promise<SendImageEncoder> {
  const original = ImageManipulator.manipulate(`data:${image.mimeType};base64,${image.data}`);
  let source: Awaited<ReturnType<typeof original.renderAsync>>;
  try {
    source = await original.renderAsync();
  } catch (error) {
    original.release();
    throw error;
  }
  return {
    async encode(options) {
      const context = ImageManipulator.manipulate(source);
      let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
      try {
        const scale = Math.min(1, options.maxDimension / Math.max(source.width, source.height));
        context.resize({
          width: Math.max(1, Math.round(source.width * scale)),
          height: Math.max(1, Math.round(source.height * scale)),
        });
        rendered = await context.renderAsync();
        const result = await rendered.saveAsync({
          format: { png: SaveFormat.PNG, jpeg: SaveFormat.JPEG, webp: SaveFormat.WEBP }[
            options.format
          ],
          compress: options.quality,
          base64: true,
        });
        new File(result.uri).delete();
        if (!result.base64)
          throw new Error("Image preparation failed. Your draft is kept; try sending again.");
        return { data: result.base64, mimeType: `image/${options.format}` };
      } finally {
        rendered?.release();
        context.release();
      }
    },
    dispose() {
      source.release();
      original.release();
    },
  };
}
