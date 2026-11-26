import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  HubLockup,
  ClisbotHubLockup,
  ClisbotHubMark,
  ClisbotLockup,
  ClisbotMark,
} from "./clisbot-brand";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const BRAND_ROOT = path.join(REPO_ROOT, "assets/brand");
const WEBSITE_PUBLIC = path.join(REPO_ROOT, "packages/website/public");

function extractPathData(svg: string): string[] {
  return [...svg.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]);
}

describe("clisbot brand assets", () => {
  it("renders canonical Clisbot and Clisbot Hub marks with currentColor", () => {
    const clisbotHtml = renderToStaticMarkup(<ClisbotMark className="h-6 w-6" />);
    const hubHtml = renderToStaticMarkup(<ClisbotHubMark className="h-6 w-6" />);
    const canonicalClisbot = readFileSync(path.join(BRAND_ROOT, "marks/clisbot-white.svg"), "utf8");
    const canonicalHub = readFileSync(path.join(BRAND_ROOT, "marks/clisbot-hub-white.svg"), "utf8");

    expect(clisbotHtml).toContain('viewBox="0 0 700 700"');
    expect(clisbotHtml).toContain('fill="currentColor"');
    expect(clisbotHtml).toContain('fill-rule="evenodd"');
    expect(extractPathData(clisbotHtml)).toEqual(extractPathData(canonicalClisbot));

    expect(hubHtml).toContain('viewBox="0 0 700 700"');
    expect(hubHtml).toContain('fill="currentColor"');
    expect(hubHtml).toContain('fill-rule="evenodd"');
    expect(extractPathData(hubHtml)).toEqual(extractPathData(canonicalHub));
  });

  it("renders canonical Clisbot, Clisbot Hub, and Hub lockups at shared 144-unit height", () => {
    const cases = [
      { Component: ClisbotLockup, file: "lockups/clisbot-white.svg", width: 678 },
      { Component: ClisbotHubLockup, file: "lockups/clisbot-hub-white.svg", width: 976 },
      { Component: HubLockup, file: "lockups/hub-white.svg", width: 466 },
    ];

    for (const { Component, file, width } of cases) {
      const html = renderToStaticMarkup(<Component className="h-6 w-auto" />);
      const canonical = readFileSync(path.join(BRAND_ROOT, file), "utf8");

      expect(html).toContain(`viewBox="0 0 ${width} 144"`);
      expect(html).toContain(`width="${width}"`);
      expect(html).toContain('height="144"');
      expect(html).toContain('fill-rule="evenodd"');
      expect(html).toContain('fill="currentColor"');
      expect(extractPathData(html)).toEqual(extractPathData(canonical));
    }
  });

  it("tightens symbol-to-wordmark spacing for display-scale lockups while keeping canonical paths", () => {
    const html = renderToStaticMarkup(<ClisbotHubLockup size="display" className="h-12 w-auto" />);
    const canonical = readFileSync(path.join(BRAND_ROOT, "lockups/clisbot-hub-white.svg"), "utf8");

    expect(html).toContain('viewBox="0 0 964 144"');
    expect(html).toContain('width="964"');
    expect(html).toContain('transform="translate(-12 0)"');
    expect(extractPathData(html)).toEqual(extractPathData(canonical));
  });

  it("keeps public/logo.svg and public/favicon.svg on the Clisbot Flow kit", () => {
    const canonicalClisbot = readFileSync(path.join(BRAND_ROOT, "marks/clisbot-white.svg"), "utf8");
    const publicLogo = readFileSync(path.join(WEBSITE_PUBLIC, "logo.svg"), "utf8");
    const publicFavicon = readFileSync(path.join(WEBSITE_PUBLIC, "favicon.svg"), "utf8");

    expect(canonicalClisbot).toContain('fill-rule="evenodd"');
    expect(publicLogo).toContain('fill-rule="evenodd"');
    expect(publicFavicon).toContain('fill="#153B43"');
    expect(publicFavicon).toContain('fill-rule="evenodd"');
  });

  it("ships a multi-size favicon.ico including 48, 32, and 16px entries", () => {
    const ico = readFileSync(path.join(WEBSITE_PUBLIC, "favicon.ico"));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const sizes: number[] = [];
    for (let i = 0; i < count; i += 1) {
      sizes.push(ico[6 + i * 16] || 256);
    }
    expect(sizes).toEqual(expect.arrayContaining([48, 32, 16]));
  });
});
