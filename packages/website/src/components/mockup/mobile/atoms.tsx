// Small shared bits for the mobile mockups. The Clisbot Flow mark is the
// app icon (packages/website/public/favicon.svg) with the black plate dropped,
// so it can be tinted and placed on any tile. Tile fills are the app's identity
// palette — packages/app/src/styles/identity-colors.ts — surfaced as
// `--color-mock-tile-*` tokens in styles.css.

const CLISBOT_MARK_D =
  "M159.6 140H442.4C470.4 140 490 161 490 189V288.4C490 291.2 488.6 292.6 485.8 292.6H383.6C344.4 292.6 320.6 316.4 320.6 352.8V386.4C320.6 417.2 306.6 432.6 277.2 432.6H161C124.6 432.6 98 406 98 371V203C98 166.6 124.6 140 159.6 140ZM172.2 186.2C160.602 186.2 151.2 195.602 151.2 207.2C151.2 218.798 160.602 228.2 172.2 228.2H393.4C404.998 228.2 414.4 218.798 414.4 207.2C414.4 195.602 404.998 186.2 393.4 186.2H172.2Z M396.2 320.6H548.8C579.6 320.6 602 344.4 602 375.2V452.2C602 484.4 582.4 508.2 551.6 508.2V544.6C551.6 554.4 546 558.6 537.6 551.6L488.6 511H379.4C344.4 511 319.2 495.6 313.6 471.8C312.9 467.6 315 466.2 319.2 464.8C337.4 459.2 348.6 446.6 348.6 425.6V376.6C348.6 345.8 365.4 320.6 396.2 320.6Z";

export function ClisbotMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 700 700"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path fillRule="evenodd" d={CLISBOT_MARK_D} />
    </svg>
  );
}

/** A hashed identity tile — one letter on a muted identity fill. */
export function LetterTile({
  letter,
  tone,
}: {
  letter: string;
  tone: "red" | "violet" | "amber" | "teal";
}) {
  return (
    <span
      className={`flex size-[18px] shrink-0 items-center justify-center rounded-[5px] text-[10px] font-semibold text-white ${TILE_TONE[tone]}`}
    >
      {letter}
    </span>
  );
}

const TILE_TONE = {
  red: "bg-mock-tile-red",
  violet: "bg-mock-tile-violet",
  amber: "bg-mock-tile-amber",
  teal: "bg-mock-tile-teal",
} as const;

/** The Clisbot project tile — Ocean Flow on the app plate. */
export function ClisbotTile() {
  return (
    <span className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] bg-[#153B43] text-[#A1DFD4]">
      <ClisbotMark size={14} />
    </span>
  );
}
