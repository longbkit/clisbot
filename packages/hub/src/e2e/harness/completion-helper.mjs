#!/usr/bin/env node
import { access, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const jobs = requiredEnvironment("HUB_E2E_COMPLETION_JOBS");
const gate = requiredEnvironment("HUB_E2E_COMPLETE_GATE");
let stopping = false;
process.once("SIGTERM", () => {
  stopping = true;
});

for (;;) {
  if (stopping) break;
  if (await exists(gate)) {
    const files = await readdir(jobs).catch(() => []);
    for (const file of files.filter((name) => name.endsWith(".json"))) {
      const path = join(jobs, file);
      const server = parseJob(await readFile(path, "utf8"));
      process.stdout.write(`completion job observed ${file}\n`);
      const response = await fetch(server.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...Object.fromEntries(server.headers.map((header) => [header.name, header.value])),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "finish_execution", arguments: {} },
        }),
      });
      process.stdout.write(`MCP finish ${file} status=${response.status}\n`);
      if (!response.ok) throw new Error(`Hub completion failed: ${response.status}`);
      await rm(path, { force: true });
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 25));
}

/** @param {string} path */
function exists(path) {
  return access(path)
    .then(() => true)
    .catch(() => false);
}

/** @param {string} name */
function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** @param {string} raw */
function parseJob(raw) {
  /** @type {unknown} */
  const value = JSON.parse(raw);
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    value.type !== "http" ||
    !("url" in value) ||
    typeof value.url !== "string" ||
    !("headers" in value) ||
    !Array.isArray(value.headers) ||
    !value.headers.every(
      (header) =>
        typeof header === "object" &&
        header !== null &&
        "name" in header &&
        typeof header.name === "string" &&
        "value" in header &&
        typeof header.value === "string",
    )
  ) {
    throw new Error("Invalid completion job");
  }
  return { url: value.url, headers: value.headers };
}
