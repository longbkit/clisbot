import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectorService } from "../../connectors/connector-service.js";
import type { SessionOutboundMessage } from "../../messages.js";
import { ConnectorSession } from "./connector-session.js";

describe("ConnectorSession Project grants", () => {
  let home: string;
  let service: ConnectorService;

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "connector-session-"));
    service = new ConnectorService({
      config: { enabled: true, composioApiUrl: "http://127.0.0.1:9" },
      clisbotHome: home,
      logger: pino({ level: "silent" }),
    });
  });

  afterEach(() => rm(home, { recursive: true, force: true }));

  function sessionFor(restricted: boolean, canManage = true) {
    const emitted: SessionOutboundMessage[] = [];
    const session = new ConnectorSession(
      service,
      (msg) => emitted.push(msg),
      pino({ level: "silent" }),
      { isRestricted: () => restricted, canManage: () => canManage },
    );
    return { session, emitted };
  }

  const grant = { apps: { gmail: { tools: "all" as const, access: "read" as const } } };

  it("stores a Project's grant for an unrestricted session and lists it", async () => {
    const { session, emitted } = sessionFor(false);
    await session.handleProjectGrantSet({
      type: "connectors.project_grant.set.request",
      requestId: "r1",
      projectId: "prj_1",
      grant,
    });
    await session.handleProjectGrantsList({
      type: "connectors.project_grants.list.request",
      requestId: "r2",
    });
    expect(emitted.map((msg) => msg.payload)).toEqual([
      { requestId: "r1", grant, error: null },
      {
        requestId: "r2",
        grants: [{ projectId: "prj_1", grant }],
        // The Host's defaults for a Project without its own tool choice.
        agentToolDefaults: { agentTools: false, browserTools: false },
        sessionAllows: {},
        error: null,
      },
    ]);
  });

  it("refuses a session limited to some Projects: the accounts are the Host owner's", async () => {
    const { session, emitted } = sessionFor(true);
    await session.handleProjectGrantSet({
      type: "connectors.project_grant.set.request",
      requestId: "r1",
      projectId: "prj_1",
      grant,
    });
    expect(emitted[0]?.payload).toMatchObject({ grant: null, errorCode: "access_denied" });
    expect(await service.projectGrants()).toEqual([]);
  });

  it("stores a grant that names nothing as no grant at all", async () => {
    const { session, emitted } = sessionFor(false);
    await session.handleProjectGrantSet({
      type: "connectors.project_grant.set.request",
      requestId: "r1",
      projectId: "prj_1",
      grant,
    });
    await session.handleProjectGrantSet({
      type: "connectors.project_grant.set.request",
      requestId: "r2",
      projectId: "prj_1",
      grant: { apps: {}, sends: "ask" },
    });
    expect(emitted[1]?.payload).toMatchObject({ grant: null, error: null });
    expect(await service.projectGrants()).toEqual([]);
  });

  it("refuses a grant with a value this daemon does not know", async () => {
    const { session, emitted } = sessionFor(false);
    await session.handleProjectGrantSet({
      type: "connectors.project_grant.set.request",
      requestId: "r1",
      projectId: "prj_1",
      grant: { apps: { gmail: { tools: "all", access: "admin" } } },
    });
    await session.handleProjectGrantSet({
      type: "connectors.project_grant.set.request",
      requestId: "r2",
      projectId: "prj_1",
      grant: { apps: { gmail: { tools: "all", access: "read" } }, dailySendLimit: 5000 },
    });
    expect(emitted.map((msg) => msg.payload)).toMatchObject([
      { errorCode: "invalid_request" },
      { errorCode: "invalid_request" },
    ]);
    expect(await service.projectGrants()).toEqual([]);
  });

  it("shows a reader a server's address without path or arguments, and lists its tools only to managers", async () => {
    await service.saveMcpServer({
      server: { name: "hooks", transport: "http", url: "https://mcp.example.com/t/secret?key=1" },
    });
    await service.saveMcpServer({
      server: { name: "local", transport: "stdio", command: "srv", args: ["--token=abc"] },
    });
    const reader = sessionFor(false, false);
    await reader.session.handleSettingsGet({
      type: "connectors.settings.get.request",
      requestId: "s",
    });
    const settings = JSON.stringify(reader.emitted[0]?.payload);
    expect(settings).toContain("https://mcp.example.com/…");
    expect(settings).not.toContain("secret");
    expect(settings).not.toContain("--token");
    await reader.session.handleToolsList({
      type: "connectors.tools.list.request",
      requestId: "t",
      mcpServer: "local",
    });
    expect(reader.emitted[1]?.payload).toMatchObject({ errorCode: "access_denied" });
  });
});
