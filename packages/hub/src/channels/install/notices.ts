// THIRD_PARTY_NOTICES gate (implementation doc §4.6 notice 9 / plan §9 step 7):
// install refuses to run for a channel whose bundled-dep license section is missing
// from the THIRD_PARTY_NOTICES file that ships with the pin manifest. This is the
// "notices travel with the supply" rule — a channel cannot be installed until its
// license provenance is recorded.
//
// The check is deliberately coarse: the channel's `notices` label must appear as a
// Markdown heading somewhere in the file. A renamed or dropped section is a miss,
// and the install fails closed.

import { readFileSync } from "node:fs";
import type { ChannelPinEntry } from "./pins.js";

export class NoticesMissingError extends Error {
  readonly channel: string;
  readonly noticesPath: string;
  constructor(channel: string, noticesPath: string) {
    super(
      `THIRD_PARTY_NOTICES section missing for channel "${channel}" (looked for a heading mentioning "${channel}"); refusing to install. Record its bundled-dep licenses in ${noticesPath} first.`,
    );
    this.name = "NoticesMissingError";
    this.channel = channel;
    this.noticesPath = noticesPath;
  }
}

/** True when `label` appears as a Markdown heading in `notices`. */
export function noticesIncludeLabel(notices: string, label: string): boolean {
  for (const line of notices.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") && trimmed.toLowerCase().includes(label.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/** Refuse when the channel's THIRD_PARTY_NOTICES section is missing. */
export function assertNoticesPresent(
  noticesPath: string,
  entry: ChannelPinEntry,
  channel: string,
): void {
  let notices: string;
  try {
    notices = readFileSync(noticesPath, "utf8");
  } catch {
    throw new NoticesMissingError(channel, noticesPath);
  }
  if (!noticesIncludeLabel(notices, entry.notices)) {
    throw new NoticesMissingError(channel, noticesPath);
  }
}
