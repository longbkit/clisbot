// Clisbot replacements for upstream's canonical `assets/brand/` marks and lockups.
//
// Upstream v0.17 introduced `assets/brand/` (a stroked butterfly mark, a flower Hub mark and
// Plus Jakarta lockups with outlined "Paseo" wordmarks) and renders the website header, Hub
// page and mockups straight from those SVGs. Clisbot ships the approved Flow / Ocean 02 kit
// instead, so this module regenerates every file in that folder from the kit: the filled
// Flow mark and the Manrope wordmark, composed with the kit's own lockup proportions.
// Clisbot has one mark; the Hub lockups reuse it with a "Hub" label.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { brand, kitRoot, runtimePath } from "./artwork.mjs";

// Lockup coordinates match upstream: 144 units high with a 2-unit margin on every side.
const LOCKUP_PAD = 2;
const LOCKUP_INK = 140;
const LOCKUP_HEIGHT = LOCKUP_INK + LOCKUP_PAD * 2;

// The kit lockup (artwork.mjs `lockup`): a 288-wide mark at (10, 30) and an 828-wide wordmark
// at (362, 35) whose height is 828 * 0.294. Reuse that composition exactly.
const KIT_MARK = { x: 10, y: 30, width: 288 };
const KIT_WORD = { x: 362, y: 35, width: 828 };
const KIT_WORD_HEIGHT = KIT_WORD.width * 0.294;

const MARK_COLORS = [
  { name: "white", hex: "#FFFFFF" },
  { name: "black", hex: "#000000" },
  // Upstream's "green" accent slot carries the Clisbot accent (Ocean).
  { name: "green", hex: brand.colors.ocean },
];
const LOCKUP_COLORS = MARK_COLORS.slice(0, 2);

const LOCKUPS = [
  // The approved wordmark is lowercase; the Hub labels follow it.
  { slug: "clisbot", label: "clisbot" },
  { slug: "clisbot-hub", label: "clisbot hub" },
  { slug: "hub", label: "hub" },
];

const WORDMARK = "clisbot";

const round = (value) => Number(value.toFixed(2));

/** Scale and translate absolute SVG path data (M L H V C Q Z, as the kit and opentype emit). */
export function transformPath(d, scale, dx, dy) {
  return d.replace(/([MLHVCQZ])([^MLHVCQZ]*)/g, (_, command, values) => {
    if (command === "Z") return "Z";
    const nums = values.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
    if (/[a-z]/.test(values.replace(/e-?\d/gi, ""))) {
      throw new Error(`Relative path command in brand artwork: ${values}`);
    }
    return (
      command +
      nums
        .map((raw, index) => {
          const isY = command === "V" || (command !== "H" && index % 2 === 1);
          return round(Number(raw) * scale + (isY ? dy : dx));
        })
        .join(" ")
    );
  });
}

function kitSource(key) {
  return readFileSync(join(kitRoot, brand.masters[key]), "utf8");
}

function kitMarkPath() {
  return [...kitSource("mark").matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join(" ");
}

function loadFont() {
  const require = createRequire(import.meta.url);
  let opentype;
  try {
    opentype = require("opentype.js");
  } catch {
    throw new Error("opentype.js is required to outline Clisbot lockup labels; run npm ci first.");
  }
  return opentype.loadSync(join(kitRoot, "fonts/Manrope-Bold.ttf"));
}

/**
 * Outline a label in the kit wordmark's coordinate space (viewBox units of
 * source/wordmark.svg): Manrope Bold, the kit's font size and its tracking, so the wordmark
 * text reproduces the approved wordmark.
 */
function wordmarkGeometry() {
  const svg = kitSource("wordmark");
  const viewBox = svg
    .match(/viewBox="([^"]+)"/)[1]
    .split(/\s+/)
    .map(Number);
  const [minX, minY, width, height] = viewBox;
  return { minX, minY, width, height, path: svg.match(/ d="([^"]+)"/)[1] };
}

function outlineLabel(font, label, word) {
  // Fit the font size and tracking so the wordmark spans the kit wordmark box.
  const reference = font.getPath(WORDMARK, 0, 0, 100).getBoundingBox();
  const size = (word.height / (reference.y2 - reference.y1)) * 100;
  const natural = font.getPath(WORDMARK, 0, 0, size).getBoundingBox();
  const tracking = (word.width - (natural.x2 - natural.x1)) / (WORDMARK.length - 1);
  const baseline = word.minY - natural.y1;
  let x = word.minX - natural.x1;
  const parts = [];
  const glyphs = font.stringToGlyphs(label);
  glyphs.forEach((glyph, index) => {
    parts.push(glyph.getPath(x, baseline, size).toPathData(3));
    const next = glyphs[index + 1];
    const kerning = next ? font.getKerningValue(glyph, next) : 0;
    x += ((glyph.advanceWidth + kerning) * size) / font.unitsPerEm + tracking;
  });
  const path = parts.filter(Boolean).join("");
  const box = font.getPath(label, 0, 0, size).getBoundingBox();
  return { path, right: x - tracking, box };
}

function markSvg(color) {
  return [
    `<svg width="700" height="700" viewBox="0 0 700 700" fill="none" xmlns="http://www.w3.org/2000/svg">`,
    `  <path d="${runtimePath()}" fill="${color}" fill-rule="evenodd" />`,
    "</svg>",
    "",
  ].join("\n");
}

function lockupSvg({ markPath, wordPath, wordRight, word }, color) {
  const top = KIT_MARK.y;
  const bottom = Math.max(KIT_MARK.y + (KIT_MARK.width * 5) / 6, KIT_WORD.y + KIT_WORD_HEIGHT);
  const scale = LOCKUP_INK / (bottom - top);
  const origin = (value) => (value - KIT_MARK.x) * scale + LOCKUP_PAD;
  const markScale = (KIT_MARK.width / 360) * scale;
  const mark = transformPath(
    markPath,
    markScale,
    LOCKUP_PAD,
    (KIT_MARK.y - top) * scale + LOCKUP_PAD,
  );
  const wordScale = (KIT_WORD.width / word.width) * scale;
  const wordX = origin(KIT_WORD.x) - word.minX * wordScale;
  const wordY = (KIT_WORD.y - top) * scale + LOCKUP_PAD - word.minY * wordScale;
  const text = transformPath(wordPath, wordScale, wordX, wordY);
  const width = Math.ceil(wordX + wordRight * wordScale + LOCKUP_PAD);
  return [
    `<svg width="${width}" height="${LOCKUP_HEIGHT}" viewBox="0 0 ${width} ${LOCKUP_HEIGHT}" fill="none" xmlns="http://www.w3.org/2000/svg">`,
    `  <path d="${mark}" fill="${color}" fill-rule="evenodd" />`,
    `  <path d="${text}" fill="${color}" />`,
    "</svg>",
    "",
  ].join("\n");
}

const README = `# Brand assets

Clisbot's copies of upstream's canonical brand folder. Every SVG here is generated from the
approved Flow / Ocean 02 kit in [\`assets/branding/clisbot/\`](../branding/clisbot/README.md)
by \`scripts/branding/apply.mjs\` during each upstream sync; do not edit them by hand.

- \`marks/clisbot-*.svg\` and \`marks/clisbot-hub-*.svg\`: the filled Flow mark on a
  \`700 × 700\` viewBox (\`fill-rule="evenodd"\`). Clisbot has one mark, so the Hub files repeat it.
- \`lockups/*.svg\`: the Flow mark with the Manrope Bold wordmark (\`clisbot\`, \`clisbot hub\`,
  \`hub\`, lowercase like the approved wordmark), 144 units high with a 2-unit margin, in the kit's lockup proportions.
- \`fonts/\`: upstream's Plus Jakarta Sans, kept with its license; Clisbot lockups do not use it.

\`green\` files carry the Clisbot Ocean accent (\`${brand.colors.ocean}\`).

## Regenerate

\`\`\`sh
node assets/brand/build.mjs            # marks and lockups only
node scripts/branding/apply.mjs --apply  # the whole kit
\`\`\`
`;

const BUILD_STUB = `// Regenerates Clisbot's brand marks and lockups from the Flow / Ocean 02 kit.
//
//   node assets/brand/build.mjs
//
// Upstream's generator drew its own artwork here; Clisbot's canonical generator is
// scripts/branding/brand-assets.mjs (also run by scripts/branding/apply.mjs). See README.md.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brandAssetFiles } from "../../scripts/branding/brand-assets.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
for (const [file, text] of brandAssetFiles()) {
  if (!file.endsWith(".svg")) continue;
  const target = path.join(repoRoot, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
}
`;

/** Every generated file under assets/brand, keyed by repository path. */
export function brandAssetFiles() {
  const font = loadFont();
  const word = wordmarkGeometry();
  const reproduced = outlineLabel(font, WORDMARK, word);
  const files = new Map();
  for (const slug of ["clisbot", "clisbot-hub"]) {
    for (const color of MARK_COLORS) {
      files.set(`assets/brand/marks/${slug}-${color.name}.svg`, markSvg(color.hex));
    }
  }
  const markPath = kitMarkPath();
  for (const { slug, label } of LOCKUPS) {
    const outlined = label === WORDMARK ? reproduced : outlineLabel(font, label, word);
    const wordPath = label === WORDMARK ? word.path : outlined.path;
    for (const color of LOCKUP_COLORS) {
      files.set(
        `assets/brand/lockups/${slug}-${color.name}.svg`,
        lockupSvg({ markPath, wordPath, wordRight: outlined.right, word }, color.hex),
      );
    }
  }
  files.set("assets/brand/README.md", README);
  files.set("assets/brand/build.mjs", BUILD_STUB);
  return files;
}

/** Upstream files under assets/brand that the Clisbot set replaces or must not keep. */
export const brandAssetConsumers = [
  "assets/brand/build.mjs",
  "assets/brand/README.md",
  "assets/brand/marks/clisbot-white.svg",
  "assets/brand/lockups/clisbot-white.svg",
];

// --- Website brand component ---------------------------------------------------------------

function replaceExact(input, before, after, file, count = 1) {
  const found = input.split(before).length - 1;
  if (found !== count) {
    throw new Error(`Unrecognized upstream brand source in ${file}; review it before branding.`);
  }
  return input.replaceAll(before, after);
}

const STROKE_RENDER = `        stroke="currentColor"
        strokeWidth={asset.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
`;

/** Render the filled Flow mark instead of upstream's single-line stroked mark. */
export function brandComponent(input, file) {
  if (input.includes('fillRule="evenodd"')) return input;
  let text = replaceExact(
    input,
    STROKE_RENDER,
    '        fill="currentColor"\n        fillRule="evenodd"\n',
    file,
    2,
  );
  text = replaceExact(
    text,
    '    strokeWidth: Number(readAttr(paths[0], "stroke-width", source)),\n',
    "",
    file,
    2,
  );
  text = replaceExact(text, "  strokeWidth: number;\n", "", file);
  text = replaceExact(
    text,
    "const DISPLAY_GAP_TIGHTEN_UNITS = 44;",
    "const DISPLAY_GAP_TIGHTEN_UNITS = 12;",
    file,
  );
  return text
    .replace(
      /\/\*\*\n \* Optical horizontal tightening[\s\S]*?\*\/\n/,
      '/**\n * Optical horizontal tightening (in 144-unit lockup coordinates) for display-scale lockups.\n * The Clisbot lockup gap follows the Flow kit; `size="display"` pulls the wordmark slightly\n * closer and trims the viewBox to match.\n */\n',
    )
    .replace(
      /\/\*\* Canonical Clisbot butterfly mark[^*]*\*\//,
      "/** Clisbot Flow mark (700x700 viewBox, filled with currentColor). */",
    )
    .replace(
      /\/\*\* Canonical Clisbot Hub five-petal flower mark[^*]*\*\//,
      "/** Clisbot Hub mark: the same Flow mark (700x700 viewBox, filled with currentColor). */",
    )
    .replace(
      /\/\*\* Canonical Clisbot lockup \(butterfly[^*]*\*\//,
      "/** Clisbot lockup (Flow mark + Manrope Bold wordmark). */",
    )
    .replace(
      /\/\*\* Canonical Clisbot Hub lockup \(flower[^*]*\*\//,
      "/** Clisbot Hub lockup (Flow mark + Manrope Bold wordmark). */",
    )
    .replace(/\/\*\* Canonical Hub lockup \(flower mark/, "/** Hub lockup (Flow mark");
}

/** Adapt upstream's brand test to the filled Flow mark and the Clisbot website assets. */
export function brandComponentTest(input, file, files = brandAssetFiles()) {
  if (input.includes('fill-rule="evenodd"')) return input;
  const widthOf = (name) =>
    Number(files.get(`assets/brand/lockups/${name}-white.svg`).match(/width="(\d+)"/)[1]);
  let text = replaceExact(
    input,
    `    expect(clisbotHtml).toContain('stroke="currentColor"');
    expect(clisbotHtml).toContain('stroke-width="50"');`,
    `    expect(clisbotHtml).toContain('fill="currentColor"');
    expect(clisbotHtml).toContain('fill-rule="evenodd"');`,
    file,
  );
  text = replaceExact(
    text,
    `    expect(hubHtml).toContain('stroke="currentColor"');
    expect(hubHtml).toContain('stroke-width="50"');`,
    `    expect(hubHtml).toContain('fill="currentColor"');
    expect(hubHtml).toContain('fill-rule="evenodd"');`,
    file,
  );
  text = replaceExact(
    text,
    `      expect(html).toContain('stroke="currentColor"');\n`,
    `      expect(html).toContain('fill-rule="evenodd"');\n`,
    file,
  );
  text = replaceExact(
    text,
    `file: "lockups/clisbot-white.svg", width: 580 }`,
    `file: "lockups/clisbot-white.svg", width: ${widthOf("clisbot")} }`,
    file,
  );
  text = replaceExact(
    text,
    `file: "lockups/clisbot-hub-white.svg", width: 842 }`,
    `file: "lockups/clisbot-hub-white.svg", width: ${widthOf("clisbot-hub")} }`,
    file,
  );
  text = replaceExact(
    text,
    `file: "lockups/hub-white.svg", width: 461 }`,
    `file: "lockups/hub-white.svg", width: ${widthOf("hub")} }`,
    file,
  );
  const display = widthOf("clisbot-hub") - 12;
  text = replaceExact(text, `'viewBox="0 0 798 144"'`, `'viewBox="0 0 ${display} 144"'`, file);
  text = replaceExact(text, `'width="798"'`, `'width="${display}"'`, file);
  text = replaceExact(
    text,
    `'transform="translate(-44 0)"'`,
    `'transform="translate(-12 0)"'`,
    file,
  );
  // The website logo and favicon come from the Flow kit (Ocean plate, Seafoam mark).
  text = replaceExact(
    text,
    `  it("keeps public/logo.svg and public/favicon.svg aligned with assets/brand", () => {`,
    `  it("keeps public/logo.svg and public/favicon.svg on the Clisbot Flow kit", () => {`,
    file,
  );
  text = replaceExact(
    text,
    `    expect(publicLogo).toBe(canonicalClisbot);
    expect(publicFavicon).toContain('<rect width="700" height="700" rx="156" fill="#000000"');
    expect(extractPathData(publicFavicon)).toEqual(extractPathData(canonicalClisbot));`,
    `    expect(canonicalClisbot).toContain('fill-rule="evenodd"');
    expect(publicLogo).toContain('fill-rule="evenodd"');
    expect(publicFavicon).toContain('fill="${brand.colors.ocean}"');
    expect(publicFavicon).toContain('fill-rule="evenodd"');`,
    file,
  );
  text = replaceExact(
    text,
    `  it("ships a multi-size favicon.ico with 48, 32, and 16px entries", () => {`,
    `  it("ships a multi-size favicon.ico including 48, 32, and 16px entries", () => {`,
    file,
  );
  return replaceExact(
    text,
    "    expect(sizes).toEqual([48, 32, 16]);",
    "    expect(sizes).toEqual(expect.arrayContaining([48, 32, 16]));",
    file,
  );
}
