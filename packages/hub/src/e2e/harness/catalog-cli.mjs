// The authored Hub bundle names native providers. Give the isolated daemon catalogue
// discovery over stdio. Workflow turns themselves run on the separate ACP fixture.
import { createInterface } from "node:readline";

const [provider, ...args] = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write(provider === "codex" ? "codex-cli 0.130.0\n" : "2.1.0 (Claude Code)\n");
} else if (provider === "codex" && args.includes("app-server")) {
  const methods = new Map([
    ["initialize", { userAgent: "hub-fixture" }],
    ["model/list", { data: [] }],
    ["config/read", { config: {} }],
    ["collaborationMode/list", { data: [] }],
  ]);
  for await (const line of createInterface({ input: process.stdin })) {
    const request = JSON.parse(line);
    if (request.id === undefined) continue;
    const reply = methods.has(request.method)
      ? { result: methods.get(request.method) }
      : { error: { code: -32601, message: "Only catalog discovery is available" } };
    process.stdout.write(JSON.stringify({ id: request.id, ...reply }) + "\n");
  }
} else if (provider === "claude" && args.includes("stream-json")) {
  for await (const line of createInterface({ input: process.stdin })) {
    const message = JSON.parse(line);
    if (message.type !== "control_request" || message.request.subtype !== "initialize") {
      process.exitCode = 1;
      break;
    }
    const response = {
      subtype: "success",
      request_id: message.request_id,
      response: { models: [], commands: [] },
    };
    process.stdout.write(JSON.stringify({ type: "control_response", response }) + "\n");
  }
} else {
  process.exitCode = 1;
}
