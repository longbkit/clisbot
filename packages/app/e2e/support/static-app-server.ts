import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import path from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
};
function finish(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}
function inside(root: string, filename: string): boolean {
  return filename === root || filename.startsWith(`${root}${path.sep}`);
}
async function resolveFile(root: string, pathname: string, html: boolean): Promise<string | null> {
  const candidate = path.resolve(root, `.${pathname}`);
  if (!inside(root, candidate)) return null;
  try {
    const filename = await realpath(candidate);
    if (!inside(root, filename)) return null;
    if ((await stat(filename)).isFile()) return filename;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return html || !path.extname(pathname) ? path.join(root, "index.html") : null;
}

/** Serves an already exported app without running Metro beside the isolated daemon. */
export async function startStaticAppServer(directory: string, port: number) {
  const root = await realpath(directory);
  const index = await realpath(path.join(root, "index.html"));
  if (!inside(root, index) || !(await stat(index)).isFile())
    throw new Error("E2E_STATIC_APP_DIR must contain index.html");
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        finish(response, 405, "Method not allowed");
        return;
      }
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
      } catch {
        finish(response, 400, "Invalid URL");
        return;
      }
      const filename = await resolveFile(
        root,
        pathname,
        request.headers.accept?.includes("text/html") === true,
      );
      if (!filename) {
        finish(response, 404, "Not found");
        return;
      }
      const metadata = await stat(filename);
      response.writeHead(200, {
        "Content-Type": CONTENT_TYPES[path.extname(filename)] ?? "application/octet-stream",
        "Content-Length": metadata.size,
        "Cache-Control": "no-store",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      const stream = createReadStream(filename);
      stream.on("error", () => response.destroy());
      response.on("close", () => stream.destroy());
      stream.pipe(response);
    })().catch(() => {
      if (!response.headersSent) finish(response, 500, "Unable to serve app asset");
      else response.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Static app server did not acquire a port");
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      }),
  };
}
