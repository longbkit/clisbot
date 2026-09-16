/**
 * The Hub's own address as it is recorded on a `SessionActor`.
 *
 * Every identity snapshot Hub writes — app admission, Automation, channel — must
 * carry the *same* string for the same Hub, because `sessionParticipantKey`
 * compares it verbatim to decide whether two snapshots are the same person. The
 * configured public base URL is not usable as-is: `publicUrl()` returns
 * `new URL(...).toString()`, which appends a trailing slash to a bare origin, so
 * passing it through raw makes an app snapshot and a channel snapshot disagree
 * by one character and silently stop grouping.
 *
 * Deliberately narrower than the daemon's `normalizeHubUrl`, which keeps the
 * pathname because a relationship record addresses a Hub that may live under a
 * subpath. An actor scope is the origin alone.
 */
export function normalizeHubOrigin(publicBaseUrl: string): string {
  return new URL(publicBaseUrl).origin;
}
