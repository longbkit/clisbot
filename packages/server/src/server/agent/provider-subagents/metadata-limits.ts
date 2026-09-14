export const SUBAGENT_METADATA_LIMITS = {
  descriptorBytes: 64 * 1024,
  cacheBytes: 4 * 1024 * 1024,
  parents: 64,
};

export function descriptorBytes(value: object): number {
  // Bound strings before serializing, including hostile titles or opaque IDs.
  let bytes = 0;
  for (const field of Object.values(value))
    if (typeof field === "string") {
      bytes += Buffer.byteLength(field);
      if (bytes > SUBAGENT_METADATA_LIMITS.descriptorBytes)
        throw new Error("Provider subagent descriptor exceeds byte budget");
    }
  bytes = Buffer.byteLength(JSON.stringify(value));
  if (bytes > SUBAGENT_METADATA_LIMITS.descriptorBytes)
    throw new Error("Provider subagent descriptor exceeds byte budget");
  return bytes;
}
