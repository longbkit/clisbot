/** A Hub origin on this machine's loopback: the Hub runs on the Host that reported it. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}
