#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { loadSync } from "opentype.js";
import {
  colors,
  containers,
  icon,
  kitRoot,
  lockup,
  mark,
  socialCard,
  svg,
  transparentMark,
} from "./artwork.mjs";
import { captureTargets } from "./capture-targets.mjs";

const out = join(kitRoot, "exports");
const artifacts = [];
const installs = [];
const font = loadSync(join(kitRoot, "fonts/Manrope-Bold.ttf"));

function outlineText(input) {
  return input.replace(/<text ([^>]+)>([^<]+)<\/text>/g, (_, attrs, text) => {
    const value = (name) => attrs.match(new RegExp(`${name}="([^"]+)"`))?.[1];
    const path = font.getPath(
      text,
      Number(value("x")),
      Number(value("y")),
      Number(value("font-size")),
    );
    path.fill = value("fill");
    return path.toSVG(3);
  });
}

function save(file, bytes, targets = []) {
  const path = join(out, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  artifacts.push({
    file,
    bytes: Buffer.byteLength(bytes),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  for (const target of targets) installs.push({ artifact: file, target });
}

async function raster(file, source, targets = []) {
  save(file, await sharp(Buffer.from(source)).png().toBuffer(), targets);
}

const app = "packages/app/assets/images/";
const web = "packages/website/public/";
const desktop = "packages/desktop/assets/";

async function exportLogos() {
  for (const [name, color] of Object.entries({
    ocean: colors.ocean,
    seafoam: colors.seafoam,
    black: "#000000",
    white: "#FFFFFF",
  })) {
    const source = svg(360, 300, mark({ color }));
    const targets = [];
    if (name === "ocean") targets.push(web + "logo.svg", app + "butterfly-green.svg");
    if (name === "white") targets.push(app + "butterfly-white.svg");
    save(`logos/mark-${name}.svg`, source, targets);
    await raster(`logos/mark-${name}.png`, transparentMark(2048, color));
    save(`logos/lockup-${name}.svg`, lockup(color));
    await raster(`logos/lockup-${name}.png`, lockup(color));
  }
  save("logos/mark-current-color.svg", readFileSync(join(kitRoot, "source/mark.svg")));
  save("logos/wordmark.svg", readFileSync(join(kitRoot, "source/wordmark.svg")));
}

async function exportAppIcons() {
  for (const size of [16, 24, 32, 48, 64, 128, 180, 192, 256, 512, 1024]) {
    const targets = [];
    if ([32, 64, 128].includes(size)) targets.push(`${desktop}${size}x${size}.png`);
    if (size === 256) targets.push(desktop + "128x128@2x.png");
    if (size === 512) targets.push(desktop + "icon.png");
    await raster(`icons/ocean-${size}.png`, icon({ size }), targets);
    await raster(`icons/light-${size}.png`, icon({ size, light: true }));
  }
  save("icons/app-ocean.svg", icon());
  save("icons/app-light.svg", icon({ light: true }));
  await raster("icons/app-store-1024.png", icon({ rounded: false }), [app + "icon.png"]);
  await raster("icons/play-store-512.png", icon({ size: 512, rounded: false }), [
    "fastlane/metadata/android/en-US/images/icon.png",
  ]);
  await raster("icons/desktop-dev-1024.png", icon({ dev: true }), [desktop + "icon-dev.png"]);
  for (const size of [180, 192, 512]) {
    const name = size === 180 ? "apple-touch-icon.png" : `pwa-icon-${size}.png`;
    await raster(`icons/${name}`, icon({ size, rounded: false, coverage: 0.54 }), [
      `packages/app/public/${name}`,
      ...(size === 180 ? [web + name] : []),
    ]);
  }
}

async function exportPlatformLayers() {
  const foreground = transparentMark(1024, colors.seafoam, 0.5);
  save("android/adaptive-foreground.svg", foreground);
  await raster("android/adaptive-foreground.png", foreground, [
    app + "android-icon-foreground.png",
  ]);
  await raster("android/adaptive-monochrome.png", transparentMark(1024, "#FFFFFF", 0.5), [
    app + "android-icon-monochrome.png",
  ]);
  save(
    "android/adaptive-background.svg",
    svg(1024, 1024, `<rect width="1024" height="1024" fill="${colors.ocean}"/>`),
  );
  for (const size of [24, 48, 72, 96]) {
    await raster(
      `notifications/notification-${size}.png`,
      transparentMark(size, "#FFFFFF", 0.82, true),
      size === 96 ? [app + "notification-icon.png"] : [],
    );
  }
  await raster("notifications/browser-notification-192.png", icon({ size: 192 }), [
    app + "browser-notification-icon.png",
  ]);
  for (const [name, color] of [
    ["light", colors.ocean],
    ["dark", colors.seafoam],
  ]) {
    const file = name === "light" ? "splash-icon.png" : "splash-icon-dark.png";
    await raster(`splash/${file}`, transparentMark(200, color), [app + file]);
    save(`splash/mark-${name}.svg`, transparentMark(200, color));
  }
}

async function exportFavicons() {
  for (const theme of ["dark", "light"]) {
    for (const status of [undefined, "running", "attention"]) {
      const name = `favicon-${theme}${status ? `-${status}` : ""}`;
      const source = icon({ size: 48, light: theme === "light", coverage: 0.72, status });
      save(`favicons/${name}.svg`, source, [app + name + ".svg"]);
      const targets = [app + name + ".png"];
      if (theme === "dark" && !status) targets.push(app + "favicon.png");
      await raster(`favicons/${name}.png`, source, targets);
    }
  }
  save("favicons/favicon.svg", icon({ size: 48, coverage: 0.72 }), [web + "favicon.svg"]);
  const frames = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256])
    frames.push({
      size,
      data: await sharp(Buffer.from(icon({ size, coverage: 0.72 })))
        .png()
        .toBuffer(),
    });
  save("desktop/icon.ico", containers("ico", frames), [desktop + "icon.ico", web + "favicon.ico"]);
  const icns = [];
  for (const [type, size] of [
    ["icp4", 16],
    ["icp5", 32],
    ["icp6", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
  ]) {
    icns.push({
      type,
      data: await sharp(Buffer.from(icon({ size })))
        .png()
        .toBuffer(),
    });
  }
  save("desktop/icon.icns", containers("icns", icns), [desktop + "icon.icns"]);
}

await exportLogos();
await exportAppIcons();
await exportPlatformLayers();
await exportFavicons();
save("social/og-image.svg", outlineText(socialCard()));
await raster("social/og-image.png", outlineText(socialCard()), [web + "og-image.png"]);
for (const item of captureTargets) {
  const file = `marketing/${item.file}`;
  if (existsSync(join(out, file))) save(file, readFileSync(join(out, file)), item.targets);
}
const manifest = { version: 1, direction: "B1-A Flow / Ocean 02", artifacts, installs };
writeFileSync(join(kitRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify(
    { artifacts: artifacts.length, installationTargets: installs.length, output: out },
    null,
    2,
  ),
);
