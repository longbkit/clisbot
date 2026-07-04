// Serves the built-in web demo against the scripted feed for manual preview
// and screenshot capture. The same fixture drives the Playwright e2e
// (test/web-demo.e2e.test.ts).
//
//   bun run scripts/web-demo-evidence-server.ts [port]
import { startWebDemoServer } from "../test/support/web-demo-server.ts";

const port = Number(process.argv[2] ?? "8787");
const server = await startWebDemoServer({ port });
console.log(`web demo evidence server: ${server.demoUrl}`);

// Publish the live completion a moment after boot so an open browser sees
// the SSE path in action; replay covers everything before that.
setTimeout(() => server.publishCompletion(), 5_000);
