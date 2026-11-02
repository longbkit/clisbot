/**
 * Motion rules for the phone's back swipe (docs/mobile-panels.md#detail-back-swipe). The release
 * thresholds are the panels' own: a third of the width, or a 500 px/s fling.
 */
const COMMIT_FRACTION = 1 / 3;
const FLING_VELOCITY = 500;
/** The slowest settle: a full width in this time. A faster finger settles faster. */
const FULL_WIDTH_SETTLE_MS = 250;
const MIN_SETTLE_MS = 60;
/** How dark the tabs underneath start; the scrim fades as the detail slides off. */
const SCRIM_MAX_OPACITY = 0.18;

export interface BackSwipeRelease {
  /** True: slide the detail off and go Back. False: slide it home. */
  commit: boolean;
  durationMs: number;
}

/** The detail's offset for a finger at `translationX`: it never moves left of its home. */
export function backSwipeOffset(translationX: number, width: number): number {
  "worklet";
  return Math.min(Math.max(translationX, 0), Math.max(width, 0));
}

export function resolveBackSwipeRelease(input: {
  translationX: number;
  velocityX: number;
  width: number;
  /** False when the gesture was canceled rather than released. */
  success: boolean;
}): BackSwipeRelease {
  "worklet";
  const { velocityX, width } = input;
  const offset = backSwipeOffset(input.translationX, width);
  const flungForward = velocityX > FLING_VELOCITY;
  const flungBack = velocityX < -FLING_VELOCITY;
  const commit =
    input.success &&
    width > 0 &&
    (flungForward || (offset > width * COMMIT_FRACTION && !flungBack));
  const distance = commit ? width - offset : offset;
  const speed = Math.max(Math.abs(velocityX), (width * 1000) / FULL_WIDTH_SETTLE_MS);
  const durationMs = speed > 0 ? (distance / speed) * 1000 : 0;
  return {
    commit,
    durationMs: Math.min(Math.max(durationMs, MIN_SETTLE_MS), FULL_WIDTH_SETTLE_MS),
  };
}

export function backSwipeScrimOpacity(offset: number, width: number): number {
  "worklet";
  if (width <= 0 || offset <= 0) return 0;
  return SCRIM_MAX_OPACITY * (1 - Math.min(offset / width, 1));
}
