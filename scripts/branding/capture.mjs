#!/usr/bin/env node
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { chromium } from "playwright";
import sharp from "sharp";
import { kitRoot } from "./artwork.mjs";
import { captureTargets } from "./capture-targets.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const preview = fileURLToPath(new URL("./preview/", import.meta.url));
const out = join(kitRoot, "exports/marketing");
mkdirSync(out, { recursive: true });
const publicAssets = {
  name: "branding-public-assets",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url !== "/blank-page.svg") return next();
      res.setHeader("Content-Type", "image/svg+xml");
      res.end(readFileSync(join(repo, "packages/website/public/blank-page.svg")));
    });
  },
};
const server = await createServer({
  configFile: false,
  root: preview,
  publicDir: kitRoot,
  plugins: [publicAssets, react(), tailwind()],
  resolve: { alias: { "~": join(repo, "packages/website/src") } },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [repo] } },
});
let browser;
try {
  await server.listen();
  const port = server.httpServer.address().port;
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ reducedMotion: "reduce", deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const item of captureTargets) {
    const height = Math.round(item.height);
    await page.setViewportSize({ width: item.width, height });
    await page.goto(
      `http://127.0.0.1:${port}/?view=${item.view}&width=${item.width}&height=${height}`,
      { waitUntil: "networkidle" },
    );
    await page.locator("#capture").waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const styled = await page
      .locator("#capture .flex")
      .first()
      .evaluate((element) => getComputedStyle(element).display === "flex");
    if (!styled)
      throw new Error("Mockup Tailwind styles did not load; refusing to export unstyled UI.");
    const broken = await page
      .locator("#capture img")
      .evaluateAll((images) =>
        images
          .filter((image) => !image.complete || !image.naturalWidth)
          .map((image) => image.getAttribute("src")),
      );
    if (broken.length) throw new Error(`Missing mockup images: ${broken.join(", ")}`);
    const oldLogo = await page.locator('#capture path[d^="M291.495 91.399"]').count();
    if (oldLogo) throw new Error("Apply the Clisbot visual kit before capturing marketing images.");
    if (errors.length) throw new Error(errors.join("\n"));
    const content = await page.locator("#capture").innerText();
    if (/paseo|getpaseo/i.test(content)) throw new Error(`Upstream branding in ${item.file}`);
    if (content.length < 100) throw new Error(`Missing mockup content in ${item.file}`);
    const bytes = await page.locator("#capture").screenshot({ animations: "disabled" });
    const image = sharp(bytes);
    if (item.file.endsWith(".webp")) await image.webp({ quality: 90 }).toFile(join(out, item.file));
    else await image.png().toFile(join(out, item.file));
    console.log(item.file);
  }
} finally {
  await browser?.close();
  await server.close();
}
