/** Remembers the most recent `capacity` keys; `remember` is true only the first time. */
export class OnceMemory {
  private readonly keys = new Set<string>();

  constructor(private readonly capacity: number) {}

  remember(key: string): boolean {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    if (this.keys.size > this.capacity) {
      const oldest = this.keys.values().next().value;
      if (oldest !== undefined) this.keys.delete(oldest);
    }
    return true;
  }
}
