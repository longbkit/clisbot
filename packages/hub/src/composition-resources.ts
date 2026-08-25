export type CloseResource = () => Promise<void>;

/** Owns composed runtime resources and closes every one in reverse acquisition order. */
export class CompositionResources {
  private resources: CloseResource[] = [];
  private closing: Promise<void> | undefined;

  own(close: CloseResource): void {
    if (this.closing !== undefined) throw new Error("composition resources are already closing");
    this.resources.push(close);
  }

  close(): Promise<void> {
    this.closing ??= this.closeOwnedResources();
    return this.closing;
  }

  private async closeOwnedResources(): Promise<void> {
    const errors: unknown[] = [];
    for (const close of this.resources.toReversed()) {
      try {
        await close();
      } catch (error) {
        errors.push(error);
      }
    }
    this.resources = [];
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(errors, "multiple composition resources failed to close");
  }
}
