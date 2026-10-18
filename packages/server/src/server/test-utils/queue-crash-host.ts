// Isolated subprocess fixture, intentionally killed by queue-crash.e2e.test.ts.
import pino from "pino";
import path from "node:path";
import { createTestClisbotDaemon } from "./clisbot-daemon.js";
import { createTestAgentClients } from "./fake-agent-client.js";
const root = process.argv[2]!;
const daemon = await createTestClisbotDaemon({
  clisbotHomeRoot: root,
  staticDir: path.join(root, "static"),
  cleanup: false,
  agentSessionStorage: true,
  bots: { enabled: true, root: path.join(root, "homes") },
  logger: pino({ level: "silent" }),
  agentClients: createTestAgentClients({ beforeTurnComplete: () => new Promise<void>(() => {}) }),
});
process.send?.({ port: daemon.port });
