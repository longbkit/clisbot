import { createServer, type ServerResponse } from "node:http";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createTestClisbotDaemon } from "../../../server/src/server/test-utils/clisbot-daemon.ts";
import { MockLoadTestAgentClient } from "../../../server/src/server/agent/providers/mock-load-test-agent.ts";
import type { SeedDaemonClient } from "../../e2e/support/helpers/seed-client.ts";

// The app package's test helpers are CommonJS; the daemon bootstrap is ESM.
const clientLoader: typeof import("../../e2e/support/helpers/daemon-client-loader.ts") =
  createRequire(import.meta.url)("../../e2e/support/helpers/daemon-client-loader.ts");
const serverId = process.env.CLISBOT_NATIVE_PERF_SERVER_ID ?? "srv_cto019_native";
interface SessionRecord {
  agentId: string;
  workspaceId: string;
  cwd: string;
}
interface Fixture {
  root: string;
  projectRoot: string;
  projectId: string;
  daemon: Awaited<ReturnType<typeof createTestClisbotDaemon>>;
  client: SeedDaemonClient;
  records: SessionRecord[];
}

async function prepareEnvironment(root: string) {
  // Reusing a seeded home would duplicate the synthetic catalog on restart.
  const occupied = await access(path.join(root, "environment/home")).then(
    () => true,
    () => false,
  );
  if (occupied) throw new Error("Use a fresh CTO019_EVIDENCE directory for a new fixture");
  await mkdir(path.join(root, "environment/home"), { recursive: true });
  await writeFile(
    path.join(root, "environment/fake-tailscale"),
    '#!/usr/bin/env bash\nprintf \'{"BackendState":"Stopped"}\\n\'\n',
    { mode: 0o755 },
  );
  process.env.CLISBOT_TAILSCALE_BIN = path.join(root, "environment/fake-tailscale");
  process.env.CLISBOT_SERVER_ID = serverId;
}

async function startFixture(root: string): Promise<Fixture> {
  await prepareEnvironment(root);
  const daemon = await createTestClisbotDaemon({
    isDev: true,
    agentClients: { mock: new MockLoadTestAgentClient() },
    clisbotHomeRoot: path.join(root, "environment/home"),
    cleanup: false,
    mcpEnabled: false,
    relayEnabled: false,
  });
  const client = await clientLoader.connectDaemonClient<SeedDaemonClient>({
    clientIdPrefix: "cto019-fixture",
    port: daemon.port,
  });
  await client.fetchAgents();
  const projectRoot = path.join(root, "environment/project");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "fixture.txt"), "Synthetic native tab benchmark\n");
  const { project, error } = await client.addProject(projectRoot);
  if (error || !project) throw new Error(error ?? "No project");
  return { root, projectRoot, projectId: project.projectId, daemon, client, records: [] };
}

async function addHistory(fixture: Fixture, record: SessionRecord, index: number) {
  if (index > 1) return;
  const pairs = index === 0 ? 5 : 200;
  for (let n = 0; n < pairs; n++) {
    await fixture.daemon.daemon.agentManager.appendTimelineItem(record.agentId, {
      type: "user_message",
      text: `Synthetic question ${n}`,
    });
    await fixture.daemon.daemon.agentManager.appendTimelineItem(record.agentId, {
      type: "assistant_message",
      text:
        `## Synthetic response ${n}\n\n` +
        "Native fixture content with **markdown**, state and scroll anchors.\n\n".repeat(
          index === 0 ? 1 : 10,
        ),
    });
  }
}

async function createSession(fixture: Fixture): Promise<SessionRecord> {
  const index = fixture.records.length;
  const title = `Native session ${String(index).padStart(4, "0")}`;
  const cwd = path.join(fixture.projectRoot, `session-${String(index).padStart(4, "0")}`);
  await mkdir(cwd, { recursive: true });
  await writeFile(path.join(cwd, "fixture.txt"), `Synthetic file ${index}\n`);
  const w = await fixture.client.createWorkspace({
    source: { kind: "directory", path: cwd, projectId: fixture.projectId },
    title,
  });
  if (w.error || !w.workspace) throw new Error(w.error ?? "No workspace");
  const agent = await fixture.client.createAgent({
    provider: "mock",
    cwd,
    workspaceId: w.workspace.id,
    title,
    model: "e2e-fast-stream",
    modeId: "load-test",
  });
  const record = { agentId: agent.id, workspaceId: w.workspace.id, cwd };
  await addHistory(fixture, record, index);
  return record;
}

async function seed(fixture: Fixture, count: number) {
  if (!Number.isInteger(count) || count < 10 || count > 1000)
    throw new Error("Count must be 10–1000");
  while (fixture.records.length < count) fixture.records.push(await createSession(fixture));
  const dataset = {
    serverId,
    port: fixture.daemon.port,
    projectId: fixture.projectId,
    count: fixture.records.length,
    records: fixture.records,
  };
  await writeFile(
    path.join(fixture.root, "environment/dataset.json"),
    JSON.stringify(dataset, null, 2) + "\n",
  );
  return dataset;
}

async function handleRequest(fixture: Fixture, requestUrl: string, response: ServerResponse) {
  try {
    const url = new URL(requestUrl, "http://localhost");
    let result: unknown;
    if (url.pathname === "/seed")
      result = await seed(fixture, Number(url.searchParams.get("count") ?? 10));
    else if (url.pathname === "/stream") {
      const record = fixture.records[Number(url.searchParams.get("index") ?? 0)];
      if (!record) throw new Error("Unknown fixture session");
      await fixture.client.sendAgentMessage(record.agentId, "Synthetic deterministic stream");
      result = { started: record.agentId };
    } else
      result = {
        port: fixture.daemon.port,
        count: fixture.records.length,
        records: fixture.records,
      };
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(result));
  } catch (error) {
    response.statusCode = 500;
    response.end(String(error));
  }
}

async function main() {
  const root = process.env.CTO019_EVIDENCE;
  if (!root) throw new Error("CTO019_EVIDENCE required");
  const fixture = await startFixture(root);
  await seed(fixture, 10);
  // Serialize mutations so simultaneous control requests cannot seed duplicate records.
  let pending = Promise.resolve();
  const control = createServer((request, response) => {
    pending = pending.then(() => handleRequest(fixture, request.url ?? "/", response));
  });
  await new Promise<void>((resolve) => control.listen(0, "127.0.0.1", resolve));
  const address = control.address();
  if (!address || typeof address === "string") throw new Error("No control port");
  await writeFile(
    path.join(root, "environment/fixture.json"),
    JSON.stringify(
      {
        daemonPort: fixture.daemon.port,
        controlPort: address.port,
        pid: process.pid,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Fixture ready, 10 sessions");
  async function close() {
    control.close();
    await pending;
    await fixture.client.close();
    await fixture.daemon.close();
    process.exit(0);
  }
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
