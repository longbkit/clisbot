import { describe, expect, it } from "vitest";

import { buildWorkspaceServiceEnv, normalizeServiceEnvName } from "./workspace-service-env.js";

describe("normalizeServiceEnvName", () => {
  it("normalizes punctuation and spaces to stable env names", () => {
    expect(normalizeServiceEnvName("app-server")).toBe("APP_SERVER");
    expect(normalizeServiceEnvName("app.server")).toBe("APP_SERVER");
    expect(normalizeServiceEnvName("app server")).toBe("APP_SERVER");
  });

  it("trims leading and trailing separators", () => {
    expect(normalizeServiceEnvName("  app server  ")).toBe("APP_SERVER");
  });
});

describe("buildWorkspaceServiceEnv", () => {
  it("uses loopback host binding when daemon listen host is loopback or absent", () => {
    expect(
      buildWorkspaceServiceEnv({
        scriptName: "daemon",
        projectSlug: "clisbot",
        branchName: "main",
        daemonPort: 6868,
        daemonListenHost: null,
        peers: [{ scriptName: "daemon", port: 5173 }],
      }).HOST,
    ).toBe("127.0.0.1");

    expect(
      buildWorkspaceServiceEnv({
        scriptName: "daemon",
        projectSlug: "clisbot",
        branchName: "main",
        daemonPort: 6868,
        daemonListenHost: "localhost",
        peers: [{ scriptName: "daemon", port: 5173 }],
      }).HOST,
    ).toBe("127.0.0.1");
  });

  it("uses network host binding when daemon listen host is non-loopback", () => {
    expect(
      buildWorkspaceServiceEnv({
        scriptName: "daemon",
        projectSlug: "clisbot",
        branchName: "main",
        daemonPort: 6868,
        daemonListenHost: "100.64.0.20",
        peers: [{ scriptName: "daemon", port: 5173 }],
      }).HOST,
    ).toBe("0.0.0.0");
  });

  it("builds default branch self and service URLs", () => {
    expect(
      buildWorkspaceServiceEnv({
        scriptName: "daemon",
        projectSlug: "clisbot",
        branchName: "main",
        daemonPort: 6868,
        daemonListenHost: null,
        peers: [{ scriptName: "daemon", port: 5173 }],
      }),
    ).toEqual({
      HOST: "127.0.0.1",
      CLISBOT_PORT: "5173",
      CLISBOT_URL: "http://daemon--clisbot.localhost:6868",
      CLISBOT_SERVICE_DAEMON_PORT: "5173",
      CLISBOT_SERVICE_DAEMON_URL: "http://daemon--clisbot.localhost:6868",
    });
  });

  it("builds feature branch self and service URLs", () => {
    expect(
      buildWorkspaceServiceEnv({
        scriptName: "daemon",
        projectSlug: "clisbot",
        branchName: "feature-x",
        daemonPort: 6868,
        daemonListenHost: null,
        peers: [{ scriptName: "daemon", port: 5173 }],
      }),
    ).toEqual({
      HOST: "127.0.0.1",
      CLISBOT_PORT: "5173",
      CLISBOT_URL: "http://daemon--feature-x--clisbot.localhost:6868",
      CLISBOT_SERVICE_DAEMON_PORT: "5173",
      CLISBOT_SERVICE_DAEMON_URL: "http://daemon--feature-x--clisbot.localhost:6868",
    });
  });

  it("omits PORT while keeping CLISBOT_PORT", () => {
    const env = buildWorkspaceServiceEnv({
      scriptName: "daemon",
      projectSlug: "clisbot",
      branchName: "main",
      daemonPort: 6868,
      daemonListenHost: null,
      peers: [{ scriptName: "daemon", port: 5173 }],
    });

    expect(env.CLISBOT_PORT).toBe("5173");
    expect(env).not.toHaveProperty("PORT");
  });

  it("omits URL variables when daemon port is absent while keeping port aliases", () => {
    expect(
      buildWorkspaceServiceEnv({
        scriptName: "daemon",
        projectSlug: "clisbot",
        branchName: "main",
        daemonPort: null,
        daemonListenHost: null,
        peers: [{ scriptName: "daemon", port: 5173 }],
      }),
    ).toEqual({
      HOST: "127.0.0.1",
      CLISBOT_PORT: "5173",
      CLISBOT_SERVICE_DAEMON_PORT: "5173",
    });
  });

  it("adds peer service ports and URLs", () => {
    expect(
      buildWorkspaceServiceEnv({
        scriptName: "web",
        projectSlug: "clisbot",
        branchName: "feature-x",
        daemonPort: 6868,
        daemonListenHost: null,
        peers: [
          { scriptName: "api", port: 4000 },
          { scriptName: "web", port: 5173 },
        ],
      }),
    ).toEqual({
      HOST: "127.0.0.1",
      CLISBOT_PORT: "5173",
      CLISBOT_URL: "http://web--feature-x--clisbot.localhost:6868",
      CLISBOT_SERVICE_API_PORT: "4000",
      CLISBOT_SERVICE_API_URL: "http://api--feature-x--clisbot.localhost:6868",
      CLISBOT_SERVICE_WEB_PORT: "5173",
      CLISBOT_SERVICE_WEB_URL: "http://web--feature-x--clisbot.localhost:6868",
    });
  });

  it("uses public service URLs when a public base URL is configured", () => {
    expect(
      buildWorkspaceServiceEnv({
        scriptName: "web",
        projectSlug: "clisbot",
        branchName: "feature-x",
        daemonPort: 6868,
        daemonListenHost: null,
        serviceProxyPublicBaseUrl: "https://services.example.com",
        peers: [
          { scriptName: "api", port: 4000 },
          { scriptName: "web", port: 5173 },
        ],
      }),
    ).toMatchObject({
      CLISBOT_URL: "https://web--feature-x--clisbot.services.example.com",
      CLISBOT_SERVICE_API_URL: "https://api--feature-x--clisbot.services.example.com",
      CLISBOT_SERVICE_WEB_URL: "https://web--feature-x--clisbot.services.example.com",
    });
  });

  it("throws when normalized peer env names collide", () => {
    expect(() =>
      buildWorkspaceServiceEnv({
        scriptName: "app-server",
        projectSlug: "clisbot",
        branchName: "main",
        daemonPort: 6868,
        daemonListenHost: null,
        peers: [
          { scriptName: "app-server", port: 5173 },
          { scriptName: "app.server", port: 4000 },
        ],
      }),
    ).toThrow("Service env name collision for APP_SERVER: app-server, app.server");
  });
});
