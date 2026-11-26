// Canonical Clisbot and Clisbot Hub brand marks and lockups, sourced directly from
// `assets/brand/` (see `assets/brand/README.md`).

import type * as React from "react";
import hubLockupSvg from "../../../../assets/brand/lockups/hub-white.svg?raw";
import clisbotHubLockupSvg from "../../../../assets/brand/lockups/clisbot-hub-white.svg?raw";
import clisbotLockupSvg from "../../../../assets/brand/lockups/clisbot-white.svg?raw";
import clisbotHubMarkSvg from "../../../../assets/brand/marks/clisbot-hub-white.svg?raw";
import clisbotMarkSvg from "../../../../assets/brand/marks/clisbot-white.svg?raw";

interface ParsedMark {
  width: number;
  height: number;
  viewBox: string;
  path: string;
}

interface ParsedLockup extends ParsedMark {
  wordmarkPath: string;
}

function readAttr(tag: string, name: string, source: string): string {
  const match = tag.match(new RegExp(`${name}="([^"]+)"`));
  if (!match) {
    throw new Error(`Missing ${name} attribute in canonical brand SVG (${source})`);
  }
  return match[1];
}

function parseSvgHeader(svg: string, source: string) {
  const svgTag = svg.match(/<svg\b[^>]*>/)?.[0];
  if (!svgTag) {
    throw new Error(`Missing <svg> root in canonical brand SVG (${source})`);
  }
  const paths = [...svg.matchAll(/<path\b[^>]*\/?>/g)].map((m) => m[0]);
  return {
    width: Number(readAttr(svgTag, "width", source)),
    height: Number(readAttr(svgTag, "height", source)),
    viewBox: readAttr(svgTag, "viewBox", source),
    paths,
  };
}

function parseMark(svg: string, source: string): ParsedMark {
  const { width, height, viewBox, paths } = parseSvgHeader(svg, source);
  if (paths.length !== 1) {
    throw new Error(`Expected 1 path in brand mark SVG (${source}), found ${paths.length}`);
  }
  return {
    width,
    height,
    viewBox,
    path: readAttr(paths[0], "d", source),
  };
}

function parseLockup(svg: string, source: string): ParsedLockup {
  const { width, height, viewBox, paths } = parseSvgHeader(svg, source);
  if (paths.length !== 2) {
    throw new Error(`Expected 2 paths in brand lockup SVG (${source}), found ${paths.length}`);
  }
  return {
    width,
    height,
    viewBox,
    path: readAttr(paths[0], "d", source),
    wordmarkPath: readAttr(paths[1], "d", source),
  };
}

const CLISBOT_MARK = parseMark(clisbotMarkSvg, "marks/clisbot-white.svg");
const CLISBOT_HUB_MARK = parseMark(clisbotHubMarkSvg, "marks/clisbot-hub-white.svg");
const CLISBOT_LOCKUP = parseLockup(clisbotLockupSvg, "lockups/clisbot-white.svg");
const CLISBOT_HUB_LOCKUP = parseLockup(clisbotHubLockupSvg, "lockups/clisbot-hub-white.svg");
const HUB_LOCKUP = parseLockup(hubLockupSvg, "lockups/hub-white.svg");

function BrandMark({ asset, props }: { asset: ParsedMark; props: React.SVGProps<SVGSVGElement> }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={asset.width}
      height={asset.height}
      viewBox={asset.viewBox}
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path d={asset.path} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/**
 * Optical horizontal tightening (in 144-unit lockup coordinates) for display-scale lockups.
 * The Clisbot lockup gap follows the Flow kit; `size="display"` pulls the wordmark slightly
 * closer and trims the viewBox to match.
 */
const DISPLAY_GAP_TIGHTEN_UNITS = 12;

export interface BrandLockupProps extends React.SVGProps<SVGSVGElement> {
  /** Optical spacing scale: `"default"` for small UI/header lockups, `"display"` for large headings. */
  size?: "default" | "display";
}

function BrandLockup({ asset, props }: { asset: ParsedLockup; props: BrandLockupProps }) {
  const { size = "default", ...svgProps } = props;
  const tighten = size === "display" ? DISPLAY_GAP_TIGHTEN_UNITS : 0;
  const width = asset.width - tighten;
  const viewBox = tighten > 0 ? `0 0 ${width} ${asset.height}` : asset.viewBox;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={asset.height}
      viewBox={viewBox}
      fill="none"
      aria-hidden="true"
      {...svgProps}
    >
      <path d={asset.path} fill="currentColor" fillRule="evenodd" />
      <path
        d={asset.wordmarkPath}
        fill="currentColor"
        transform={tighten > 0 ? `translate(-${tighten} 0)` : undefined}
      />
    </svg>
  );
}

/** Clisbot Flow mark (700x700 viewBox, filled with currentColor). */
export function ClisbotMark(props: React.SVGProps<SVGSVGElement>) {
  return <BrandMark asset={CLISBOT_MARK} props={props} />;
}

/** Clisbot Hub mark: the same Flow mark (700x700 viewBox, filled with currentColor). */
export function ClisbotHubMark(props: React.SVGProps<SVGSVGElement>) {
  return <BrandMark asset={CLISBOT_HUB_MARK} props={props} />;
}

/** Clisbot lockup (Flow mark + Manrope Bold wordmark). */
export function ClisbotLockup(props: BrandLockupProps) {
  return <BrandLockup asset={CLISBOT_LOCKUP} props={props} />;
}

/** Clisbot Hub lockup (Flow mark + Manrope Bold wordmark). */
export function ClisbotHubLockup(props: BrandLockupProps) {
  return <BrandLockup asset={CLISBOT_HUB_LOCKUP} props={props} />;
}

/** Hub lockup (Flow mark + "Hub"), used where Clisbot is already on screen. */
export function HubLockup(props: BrandLockupProps) {
  return <BrandLockup asset={HUB_LOCKUP} props={props} />;
}
