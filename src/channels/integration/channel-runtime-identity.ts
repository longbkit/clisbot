import { createHash } from "node:crypto";

export function buildTokenHint(token: string) {
  return createHash("sha256")
    .update(token.trim())
    .digest("hex")
    .slice(0, 8);
}
