import type { SendImage, SendImageEncoder } from "./image-send-preparation";

export async function createSendImageEncoder(image: SendImage): Promise<SendImageEncoder> {
  const source = new Image();
  source.src = `data:${image.mimeType};base64,${image.data}`;
  await source.decode();
  const canvas = document.createElement("canvas");
  return {
    async encode(options) {
      const scale = Math.min(
        1,
        options.maxDimension / Math.max(source.naturalWidth, source.naturalHeight),
      );
      canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context)
        throw new Error("Image preparation is unavailable. Your draft is kept; try sending again.");
      if (options.format === "jpeg") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const mimeType = `image/${options.format}`;
      const url = canvas.toDataURL(mimeType, options.quality);
      const actualMimeType = url.slice(5, url.indexOf(";"));
      return { data: url.slice(url.indexOf(",") + 1), mimeType: actualMimeType };
    },
    dispose() {
      source.src = "";
      canvas.width = canvas.height = 0;
    },
  };
}
