import { readFile } from "node:fs/promises";
import path from "node:path";
import { runtimeFile } from "../runtime-files.js";

/** Only the packaged browser assets, loaded on demand for account authorization. */
export async function browserAsset(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/assets/") || !["GET", "HEAD"].includes(request.method))
    return undefined;
  const root = path.resolve(runtimeFile(".output", "client"));
  let target: string;
  try {
    target = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!target.startsWith(`${root}${path.sep}`)) return new Response(null, { status: 404 });
  try {
    const bytes = await readFile(target);
    const types: Record<string, string> = {
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".woff2": "font/woff2",
    };
    return new Response(request.method === "HEAD" ? null : new Uint8Array(bytes), {
      headers: {
        "content-type": types[path.extname(target)] ?? "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
