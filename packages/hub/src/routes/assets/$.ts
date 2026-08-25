import { readFile } from "node:fs/promises";
import { createFileRoute } from "@tanstack/react-router";
import { reportFailure } from "../../failures/index.js";
import { runtimeFile } from "../../runtime-files.js";

const ASSET_NAME = /^[A-Za-z0-9._-]+$/u;

export const Route = createFileRoute("/assets/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const name = new URL(request.url).pathname.slice("/assets/".length);
        if (!ASSET_NAME.test(name)) return new Response("Not Found", { status: 404 });
        try {
          const body = await readFile(runtimeFile(".output", "client", "assets", name));
          return new Response(body, {
            headers: {
              "cache-control": "public, max-age=31536000, immutable",
              "content-type": contentType(name),
            },
          });
        } catch (error) {
          const missing = isMissingFile(error);
          reportFailure(
            error,
            { operation: "asset.read", component: "http", method: "GET", path: `/assets/${name}` },
            { kind: missing ? "notFound" : "internal" },
          );
          return new Response(missing ? "Not Found" : "Asset unavailable", {
            status: missing ? 404 : 500,
          });
        }
      },
    },
  },
});

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT";
}

function contentType(name: string): string {
  if (name.endsWith(".css")) return "text/css; charset=utf-8";
  if (name.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}
