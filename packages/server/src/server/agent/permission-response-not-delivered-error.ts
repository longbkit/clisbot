/** A response provably did not take effect; ambiguous provider failures must stay plain errors. */
export class PermissionResponseNotDeliveredError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PermissionResponseNotDeliveredError";
  }
}
