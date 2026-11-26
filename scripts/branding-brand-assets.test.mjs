import assert from "node:assert/strict";
import test from "node:test";
import {
  brandAssetFiles,
  brandComponent,
  brandComponentTest,
  transformPath,
} from "./branding/brand-assets.mjs";
import { runtimePath } from "./branding/artwork.mjs";

test("transforms absolute path data including single-axis commands", () => {
  assert.equal(
    transformPath("M10 20H30V40C1 2 3 4 5 6Z", 2, 1, 100),
    "M21 140H61V180C3 104 7 108 11 112Z",
  );
  assert.throws(() => transformPath("M1 1l2 2", 1, 0, 0), /Relative path command/);
});

test("regenerates upstream's brand folder from the Flow kit with no Paseo artwork", () => {
  const files = brandAssetFiles();
  const flow = runtimePath();
  for (const [file, text] of files) {
    if (file.startsWith("assets/brand/marks/")) assert.ok(text.includes(`d="${flow}"`), file);
    if (file.endsWith(".svg")) {
      assert.match(text, /fill-rule="evenodd"/, file);
      assert.doesNotMatch(text, /stroke-width/, file);
    }
  }
  for (const slug of ["clisbot", "clisbot-hub", "hub"]) {
    const svg = files.get(`assets/brand/lockups/${slug}-white.svg`);
    assert.match(svg, /height="144" viewBox="0 0 \d+ 144"/);
    assert.equal([...svg.matchAll(/<path /g)].length, 2, slug);
  }
  assert.match(files.get("assets/brand/build.mjs"), /scripts\/branding\/apply\.mjs/);
  assert.deepEqual(brandAssetFiles(), files);
});

const component = `interface ParsedMark {
  path: string;
  strokeWidth: number;
}
    strokeWidth: Number(readAttr(paths[0], "stroke-width", source)),
    strokeWidth: Number(readAttr(paths[0], "stroke-width", source)),
const DISPLAY_GAP_TIGHTEN_UNITS = 44;
        d={asset.path}
        stroke="currentColor"
        strokeWidth={asset.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
        d={asset.path}
        stroke="currentColor"
        strokeWidth={asset.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
`;

test("renders filled marks in the website brand component and stops on unknown shapes", () => {
  const out = brandComponent(component, "c.tsx");
  assert.doesNotMatch(out, /stroke/);
  assert.equal(out.split('fillRule="evenodd"').length - 1, 2);
  assert.match(out, /DISPLAY_GAP_TIGHTEN_UNITS = 12/);
  assert.equal(brandComponent(out, "c.tsx"), out);
  assert.throws(() => brandComponent("export {}", "c.tsx"), /Unrecognized upstream brand source/);
  assert.throws(
    () => brandComponentTest("export {}", "c.test.tsx"),
    /Unrecognized upstream brand source/,
  );
});
