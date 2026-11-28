// Small shared bits for the mobile mockups. Tile fills are the app's identity
// palette — packages/app/src/styles/identity-colors.ts — surfaced as
// `--color-mock-tile-*` tokens in styles.css.

import { ClisbotMark as CanonicalClisbotMark } from "../../clisbot-brand";

export function ClisbotMark({ size = 20, className }: { size?: number; className?: string }) {
  return <CanonicalClisbotMark width={size} height={size} className={className} />;
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
