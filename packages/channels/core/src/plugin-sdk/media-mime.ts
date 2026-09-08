// upstream: src/plugin-sdk/media-mime.ts@5d8067a4483
// Narrow media MIME helper surface for plugins that do not need the full media runtime.

export {
  detectMime,
  extensionForMime,
  getFileExtension,
  mimeTypeFromFilePath,
  normalizeMimeType,
} from "../media-core/mime.js";
export { mediaKindFromMime, type MediaKind } from "../media-core/constants.js";
