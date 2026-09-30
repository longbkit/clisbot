#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { colors, kitRoot } from "./artwork.mjs";

const manifest = JSON.parse(readFileSync(join(kitRoot, "manifest.json"), "utf8"));
const picture = (path, alt, width) => `<img src="exports/${path}" alt="${alt}" width="${width}" />`;
const sizes = [16, 24, 32, 48, 64, 128];
const states = ["dark", "light"]
  .map(
    (theme) =>
      `<div class="state-row ${theme}">${["", "-running", "-attention"].map((state) => `<figure>${picture(`favicons/favicon-${theme}${state}.png`, theme + state, 48)}<figcaption>${state.slice(1) || "idle"}</figcaption></figure>`).join("")}</div>`,
  )
  .join("");
const gallery = manifest.artifacts
  .filter((a) => a.file.startsWith("marketing/") && a.file.endsWith(".png"))
  .map(
    (a) => `<a href="exports/${a.file}">${picture(a.file, a.file, 240)}<span>${a.file}</span></a>`,
  )
  .join("");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clisbot — Flow / Ocean 02</title><style>
@font-face{font-family:Manrope;src:url(fonts/Manrope-Variable.ttf);font-weight:200 800}*{box-sizing:border-box}body{margin:0;background:${colors.paper};color:${colors.ink};font-family:Manrope,system-ui,sans-serif}main{max-width:1200px;padding:48px;margin:auto}h1{font-size:40px;letter-spacing:-1.5px;margin:0}h2{font-size:22px;margin:32px 0 18px}p{color:#526568}a{color:inherit}header{display:flex;justify-content:space-between;align-items:center;gap:24px;border-bottom:1px solid #ccd7d4;padding-bottom:28px}.hero{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin:32px 0}.panel{display:flex;align-items:center;justify-content:center;gap:28px;padding:28px;border-radius:22px;min-height:246px}.dark{background:${colors.ocean};color:${colors.seafoam}}.light{background:#e8ebe5;color:${colors.ocean}}.panel img{max-width:100%;height:auto}.panel .lockup{width:100%;max-width:380px}.palette,.sizes,.state-row{display:flex;gap:28px;align-items:center;flex-wrap:wrap}.chip{width:120px;height:54px;border-radius:12px}.palette code{display:block;margin-top:8px}.sizes{align-items:end;padding:24px 0}figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:12px}figcaption{font-size:13px}.states{display:grid;grid-template-columns:1fr 1fr;gap:28px}.state-row{justify-content:space-around;padding:22px;border-radius:18px}.notes{font-size:14px;line-height:1.8}.social{width:100%;max-width:800px;height:auto;border-radius:14px}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:22px}.gallery a{display:flex;flex-direction:column;gap:10px;text-decoration:none;font-size:12px}.gallery img{width:100%;height:200px;object-fit:contain;background:${colors.ocean};border-radius:12px}@media(max-width:680px){main{padding:24px}.hero,.states{grid-template-columns:1fr}header{align-items:start}h1{font-size:30px}}
</style></head><body><main>
<header><div><h1>clisbot / Flow</h1><p>B1-A primary · Ocean 02 · Production artifact kit</p></div>${picture("icons/ocean-128.png", "Clisbot app icon", 92)}</header>
<section class="hero"><div class="panel dark">${picture("logos/lockup-seafoam.svg", "Clisbot light logo", 450)}</div><div class="panel light">${picture("logos/lockup-ocean.svg", "Clisbot dark logo", 450)}</div></section>
<div class="palette">${[
  ["Ocean", colors.ocean],
  ["Seafoam", colors.seafoam],
  ["Paper", colors.paper],
  ["Ink", colors.ink],
]
  .map(
    ([name, color]) =>
      `<div><div class="chip" style="background:${color};outline:1px solid #bbc9c5"></div><code>${name} ${color}</code></div>`,
  )
  .join("")}</div>
<h2>App icons at actual display sizes</h2><div class="sizes">${sizes.map((size) => `<figure>${picture(`icons/ocean-${size}.png`, `Clisbot ${size} pixel icon`, size)}<figcaption>${size} px</figcaption></figure>`).join("")}</div>
<h2>Favicon states</h2><div class="states">${states}</div>
<h2>Platform assets</h2><div class="states"><div class="state-row dark"><figure>${picture("android/adaptive-foreground.png", "Android adaptive foreground", 128)}<figcaption>Android foreground</figcaption></figure><figure>${picture("notifications/notification-96.png", "Android notification glyph", 48)}<figcaption>Notification</figcaption></figure></div><div class="state-row light"><figure>${picture("splash/splash-icon.png", "Light splash", 96)}<figcaption>Light splash</figcaption></figure><figure>${picture("icons/light-128.png", "Light app icon", 96)}<figcaption>Light icon</figcaption></figure></div></div>
<h2>Social / Open Graph</h2>${picture("social/og-image.png", "Clisbot Open Graph card", 800)}
<h2>Marketing mockups</h2><p class="notes">Rendered from repository UI components. These are marketing mockups, not captures of a native release build.</p><div class="gallery">${gallery}</div>
<h2>Files and usage</h2><p class="notes">${manifest.artifacts.length} exported files. SVG masters, transparent PNGs, platform layers, multi-resolution ICO/ICNS, and marketing images.<br>See <a href="README.md">README</a>, <a href="manifest.json">installation manifest and checksums</a>, and <a href="fonts/OFL.txt">font license</a>.</p>
</main></body></html>`;
const path = join(kitRoot, "PREVIEW.html");
writeFileSync(path, html);
if (process.argv.includes("--screenshot")) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1080 },
      deviceScaleFactor: 1,
    });
    await page.goto(pathToFileURL(path).href);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const broken = await page
      .locator("img")
      .evaluateAll((images) =>
        images.filter((i) => !i.complete || !i.naturalWidth).map((i) => i.src),
      );
    if (broken.length) throw new Error(`Broken preview images: ${broken.join(", ")}`);
    await page.screenshot({ path: join(kitRoot, "preview.png") });
  } finally {
    await browser.close();
  }
}
console.log(path);
