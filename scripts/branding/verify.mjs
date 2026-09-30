#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { kitRoot } from "./artwork.mjs";
import { captureTargets } from "./capture-targets.mjs";

const manifest = JSON.parse(readFileSync(join(kitRoot, "manifest.json"), "utf8"));
const read = (file) => readFileSync(join(kitRoot, "exports", file));
const names = new Set(manifest.artifacts.map((a) => a.file));
for (const item of captureTargets)
  assert(names.has(`marketing/${item.file}`), `Missing marketing export ${item.file}`);
for (const item of manifest.artifacts) {
  const bytes = read(item.file);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256, item.file);
  if (/\.(png|webp|svg)$/.test(item.file)) {
    const metadata = await sharp(bytes).metadata();
    assert(metadata.width > 0 && metadata.height > 0, item.file);
  }
}

for (const file of [
  "icons/app-store-1024.png",
  "icons/play-store-512.png",
  "icons/apple-touch-icon.png",
  "icons/pwa-icon-512.png",
]) {
  assert.equal((await sharp(read(file)).stats()).isOpaque, true, `${file} must be opaque`);
}
const notification = await sharp(read("notifications/notification-96.png"))
  .ensureAlpha()
  .raw()
  .toBuffer();
for (let i = 0; i < notification.length; i += 4) {
  if (notification[i + 3])
    assert.deepEqual(
      [...notification.subarray(i, i + 3)],
      [255, 255, 255],
      "Android notification must be white with alpha",
    );
}

const mask = await sharp(read("android/adaptive-foreground.png"))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
let maxRadius = 0;
for (let y = 0; y < mask.info.height; y++) {
  for (let x = 0; x < mask.info.width; x++) {
    if (mask.data[(y * mask.info.width + x) * 4 + 3] < 128) continue;
    maxRadius = Math.max(
      maxRadius,
      Math.hypot((x + 0.5) / mask.info.width - 0.5, (y + 0.5) / mask.info.height - 0.5),
    );
  }
}
assert(maxRadius < 33 / 108, `Android foreground outside safe circle: ${maxRadius}`);

const ico = read("desktop/icon.ico");
assert.equal(ico.readUInt16LE(2), 1);
const sizes = [];
for (let i = 0; i < ico.readUInt16LE(4); i++) {
  const p = 6 + i * 16;
  const size = ico[p] || 256;
  const bytes = ico.subarray(
    ico.readUInt32LE(p + 12),
    ico.readUInt32LE(p + 12) + ico.readUInt32LE(p + 8),
  );
  assert.equal((await sharp(bytes).metadata()).width, size);
  sizes.push(size);
}
assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256]);
const icns = read("desktop/icon.icns");
assert.equal(icns.toString("ascii", 0, 4), "icns");
assert.equal(icns.readUInt32BE(4), icns.length);
let frames = 0;
for (let p = 8; p < icns.length; ) {
  const length = icns.readUInt32BE(p + 4);
  assert(length > 8 && p + length <= icns.length);
  await sharp(icns.subarray(p + 8, p + length)).metadata();
  frames++;
  p += length;
}
assert.equal(frames, 7);
console.log(
  JSON.stringify(
    {
      artifacts: manifest.artifacts.length,
      installTargets: manifest.installs.length,
      checks: [
        "hashes",
        "image decoding",
        "opaque store/PWA icons",
        "white notification alpha",
        "Android safe circle",
        "ICO frames",
        "ICNS frames",
      ],
      androidMaxRadius: maxRadius,
    },
    null,
    2,
  ),
);
