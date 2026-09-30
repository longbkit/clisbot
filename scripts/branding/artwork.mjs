import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const kitRoot = fileURLToPath(new URL("../../assets/branding/clisbot/", import.meta.url));
export const brand = JSON.parse(readFileSync(join(kitRoot, "brand.json"), "utf8"));
export const colors = brand.colors;
const sources = Object.fromEntries(
  Object.entries(brand.masters).map(([key, file]) => [
    key,
    readFileSync(join(kitRoot, file), "utf8"),
  ]),
);

export function svg(width, height, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>\n`;
}

export function mark({ x = 0, y = 0, width = 360, color = colors.ocean, small = false } = {}) {
  const body = sources[small ? "small" : "mark"]
    .replace(/<svg[^>]*>|<\/svg>|<title>.*?<\/title>/gs, "")
    .trim();
  return `<g transform="translate(${x} ${y}) scale(${width / 360})" color="${color}">${body}</g>`;
}

export function wordmark({ x = 0, y = 0, width = 600, color = colors.ocean } = {}) {
  return sources.wordmark.replace(
    /<svg[^>]*>/,
    (tag) =>
      `${tag.slice(0, -1)} x="${x}" y="${y}" width="${width}" height="${width * 0.294}" color="${color}">`,
  );
}

export function lockup(color = colors.ocean) {
  return svg(
    1200,
    300,
    mark({ x: 10, y: 30, width: 288, color }) + wordmark({ x: 362, y: 35, width: 828, color }),
  );
}

export function icon({
  size = 1024,
  light = false,
  rounded = true,
  coverage = 0.62,
  status,
  dev = false,
} = {}) {
  const bg = light ? colors.paper : colors.ocean;
  const fg = light ? colors.ocean : colors.seafoam;
  const w = size * coverage;
  const statusDot = status
    ? `<circle cx="${size * 0.815}" cy="${size * 0.815}" r="${size * 0.155}" fill="${colors[status]}" stroke="${bg}" stroke-width="${size * 0.045}"/>`
    : "";
  const devBar = dev
    ? `<path d="M${size * 0.21} ${size * 0.82}H${size * 0.79}" stroke="${colors.ivory}" stroke-width="${size * 0.045}" stroke-linecap="round"/>`
    : "";
  return svg(
    size,
    size,
    `<rect width="${size}" height="${size}" rx="${rounded ? size * 0.22 : 0}" fill="${bg}"/>` +
      mark({
        x: (size - w) / 2,
        y: (size - (w * 5) / 6) / 2,
        width: w,
        color: fg,
        small: size <= 64,
      }) +
      statusDot +
      devBar,
  );
}

export function transparentMark(size, color, coverage = 0.82, small = false) {
  const w = size * coverage;
  return svg(
    size,
    size,
    mark({ x: (size - w) / 2, y: (size - (w * 5) / 6) / 2, width: w, color, small }),
  );
}

export function socialCard() {
  return svg(
    1200,
    630,
    `<rect width="1200" height="630" fill="${colors.ocean}"/>` +
      mark({ x: 80, y: 86, width: 212, color: colors.seafoam }) +
      wordmark({ x: 342, y: 90, width: 670, color: colors.seafoam }) +
      `<text x="80" y="394" fill="${colors.paper}" font-family="Manrope" font-size="44" font-weight="600">Your AI workspace and bot.</text><text x="80" y="455" fill="${colors.paper}" font-family="Manrope" font-size="30">For work and personal life.</text><text x="80" y="558" fill="${colors.seafoam}" font-family="Manrope" font-size="22">clisbot.com</text>`,
  );
}

// Keep the upstream 700×700 viewBox to minimize diffs in existing consumers.
export function runtimePath(small = false) {
  const paths = [...sources[small ? "small" : "mark"].matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
  return paths
    .map((path) =>
      path.replace(/([MCLHVZ])([^MCLHVZ]*)/g, (_, command, values) => {
        if (command === "Z") return "Z";
        const nums = values.match(/-?\d*\.?\d+/g).map(Number);
        return (
          command +
          nums
            .map((n, i) => {
              const isY = command === "V" || (command !== "H" && i % 2 === 1);
              const offset = isY ? 140 : 98;
              return Number((n * 1.4 + offset).toFixed(3));
            })
            .join(" ")
        );
      }),
    )
    .join(" ");
}

export function containers(kind, images) {
  if (kind === "icns") {
    const chunks = images.map(({ type, data }) => {
      const header = Buffer.alloc(8);
      header.write(type, 0, 4, "ascii");
      header.writeUInt32BE(data.length + 8, 4);
      return Buffer.concat([header, data]);
    });
    const head = Buffer.alloc(8);
    head.write("icns");
    head.writeUInt32BE(8 + chunks.reduce((n, c) => n + c.length, 0), 4);
    return Buffer.concat([head, ...chunks]);
  }
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const p = 6 + i * 16;
    header[p] = header[p + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, p + 4);
    header.writeUInt16LE(32, p + 6);
    header.writeUInt32LE(data.length, p + 8);
    header.writeUInt32LE(offset, p + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}
