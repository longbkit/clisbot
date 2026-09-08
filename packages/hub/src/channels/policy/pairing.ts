// DM pairing (`access.dmPolicy: pairing`): what an unknown sender sees, and
// what an operator has to type to let them in.
//
// Upstream shows the sender a short code and keeps the paired ids in its own
// store (`src/pairing/*`); approving is a config edit on the host. The Hub keeps
// the requests in `channel_pairings`, organization-scoped, and approval is a
// management-API call. The code itself is not a secret — it is a HANDLE, so the
// operator staring at a list of pending requests can tell two strangers apart.
// Nothing is granted by knowing it.
import { randomInt } from "node:crypto";

/** The code alphabet: no `0/O`, no `1/I/L` — an operator reads these aloud. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

/** Mint one pairing handle. */
export function mintPairingCode(): string {
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** True for a string this module could have minted (management-API input). */
export function isPairingCode(value: string): boolean {
  return new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`, "u").test(value);
}

/**
 * What the sender is told. One message, once: `requestPairing` returns
 * `created: false` on every repeat, and the caller stays silent then, so a
 * sender who keeps typing is not answered on every message.
 */
export function pairingChallengeText(code: string): string {
  return [
    "This assistant is not open to you yet.",
    `Ask an operator to approve pairing code **${code}**.`,
    "Once they do, send your message again.",
  ].join(" ");
}
