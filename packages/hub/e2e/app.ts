import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type Server as NetServer } from "node:net";
import { request as httpRequest } from "node:http";
import { createServer as createHttpsServer, get as httpsGet, type Server } from "node:https";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, open, readFile, rm, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import { test as base } from "@playwright/test";
import { z } from "zod";
import { PaseoHub, type BuiltApplication, type BuiltApplicationOptions } from "./helpers/hub.js";
import { SourcePaseo } from "./helpers/source-paseo.js";
import type { BrowserDiscordEvent } from "../src/e2e/harness/browser-providers.js";
import type { BrowserProviderScenario } from "../src/e2e/harness/browser-providers.js";
import type { FixtureBillingProduct } from "../src/e2e/harness/browser-billing.js";
import { ProjectExternalFacts } from "./helpers/projects/external.js";

const billingInspectSchema = z.object({ reportedSeatQuantity: z.number().nullable() });
const slackSocketEvidenceSchema = z.object({ receipts: z.number(), runs: z.number() });

export const test = base.extend<{
  hub: PaseoHub;
  projectExternal: ProjectExternalFacts;
  billing: boolean;
  providerScenario: BrowserProviderScenario;
}>({
  // Set with `test.use({ billing: true })` to configure the primary app with the fixture Stripe
  // catalog — the money test in billing-subscription.spec.ts needs a billing-configured instance.
  billing: [false, { option: true }],
  providerScenario: ["connected" as BrowserProviderScenario, { option: true }],
  hub: async (
    { browser, browserName, page, context, billing, providerScenario },
    provide,
    testInfo,
  ) => {
    if (browserName !== "chromium") {
      throw new Error(`unsupported Phase 0 browser: ${browserName}`);
    }
    const applications = new BuiltApplications();
    try {
      await page.addInitScript(() => {
        const request = window.fetch;
        window.fetch = function (input, init) {
          if (this !== undefined && this !== window) throw new TypeError("Illegal invocation");
          return request.call(window, input, init);
        };
      });
      const primary = await applications.start({
        databaseProfile: "fresh",
        billing,
        providerScenario,
      });
      await provide(
        new PaseoHub(
          primary,
          browser,
          page,
          context.request,
          (options) => applications.start(options),
          () => applications.startSourcePaseo(),
        ),
      );
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("application.log", {
          body: primary.logs(),
          contentType: "text/plain",
        });
      }
    } finally {
      await applications.stop();
    }
  },
  projectExternal: async ({ hub, request }, provide) => {
    await provide(new ProjectExternalFacts(hub.primaryApplication(), request));
  },
});

class BuiltApplications {
  private readonly running: RunningApplication[] = [];
  private readonly sourcePaseos: SourcePaseo[] = [];

  async start(options: BuiltApplicationOptions = {}): Promise<BuiltApplication> {
    const dataDirectory = await mkdtemp(join(tmpdir(), "paseo-e2e-pglite-"));
    const portLease = await reservePort();
    const reverseProxyPortLease = options.reverseProxy === true ? await reservePort() : undefined;
    const port = portLease.port;
    const reverseProxyPort = reverseProxyPortLease?.port;
    const tls =
      options.https === true || options.reverseProxy === true ? await createTestTls() : undefined;
    const publicPort = reverseProxyPort ?? port;
    const origin = `${tls === undefined ? "http" : "https"}://127.0.0.1:${publicPort}`;
    const machineKeyFile = join(tmpdir(), `paseo-e2e-machine-key-${randomUUID()}`);
    const childEnvironment = applicationEnvironment({
      dataDirectory,
      origin,
      ...(options.reverseProxy === true ? {} : { appUrl: origin }),
      port,
      machineKeyFile,
      ...(options.https === true && tls !== undefined ? { tls } : {}),
      ...options,
    });
    const spawnServer = () =>
      spawn(process.execPath, ["dist/e2e/harness/browser-child.js"], {
        cwd: process.cwd(),
        env: childEnvironment,
        stdio: ["pipe", "pipe", "pipe", "ipc"],
      });
    let server = spawnServer();
    let serverPortHandoff = handoffPortWhenRequested(server, portLease);
    const output: string[] = [];
    const proxy =
      reverseProxyPortLease === undefined || tls === undefined
        ? undefined
        : await startReverseProxy(reverseProxyPortLease, port, tls);
    const application: RunningApplication = {
      origin,
      machineKey: "",
      dataDirectory,
      portLeases: [
        portLease,
        ...(reverseProxyPortLease === undefined ? [] : [reverseProxyPortLease]),
      ],
      server,
      ...(proxy === undefined ? {} : { proxy }),
      ...(tls === undefined ? {} : { tlsRoot: tls.root }),
      logs: () => output.join(""),
      deliverDiscord: (event: BrowserDiscordEvent) => deliverDiscord(server, event),
      setGitHubConfiguration: (input: {
        repositoryId: number;
        commitSha: string;
        files?: readonly { path: string; content: string }[];
      }) => deliverCommand(server, { type: "github-configuration", ...input }),
      setBillingProduct: (product: FixtureBillingProduct) =>
        deliverCommand(server, { type: "billing-product", product }),
      cancelSubscription: (organizationId: string) =>
        deliverCommand(server, { type: "billing-cancel-subscription", organizationId }),
      failNextAccountSetup: () => deliverCommand(server, { type: "fail-next-account-setup" }),
      issueDaemonEnrollment: (verifier: string) =>
        deliverCommand(server, { type: "daemon-enrollment-token", verifier }),
      failNextProjectRead: () => deliverCommand(server, { type: "fail-next-project-read" }),
      prepareSlackSocketWorkflow: () => deliverCommand(server, { type: "slack-socket-prepare" }),
      deliverSlackSocketMention: (eventId: string) =>
        deliverCommand(server, { type: "slack-socket-deliver", eventId }),
      slackSocketEvidence: async (eventId: string) =>
        slackSocketEvidenceSchema.parse(
          await deliverCommandForData(server, { type: "slack-socket-inspect", eventId }),
        ),
      query: async (sql, params = []) => {
        const rows = await deliverCommandForData(server, { type: "database-query", sql, params });
        if (!Array.isArray(rows)) throw new Error("database query returned invalid rows");
        return rows as Record<string, unknown>[];
      },
      installUnroutedSlackFixture: (input) =>
        deliverCommand(server, { type: "install-unrouted-slack-fixture", ...input }),
      installProviderDispatchFixture: (input) =>
        deliverCommand(server, { type: "install-provider-dispatch-fixture", ...input }),
      restart: async () => {
        await stopServer(server);
        await portLease.reacquire();
        server = spawnServer();
        serverPortHandoff = handoffPortWhenRequested(server, portLease);
        application.server = server;
        await serverPortHandoff;
        await serverReady(server, origin, output);
      },
      reportedSeatQuantity: async (organizationId: string) => {
        const data = await deliverCommandForData(server, {
          type: "billing-inspect",
          organizationId,
        });
        return billingInspectSchema.parse(data).reportedSeatQuantity;
      },
    };
    this.running.push(application);
    await serverPortHandoff;
    await serverReady(server, origin, output);
    application.machineKey = (await readFile(machineKeyFile, "utf8")).trim();
    return application;
  }

  async stop(): Promise<void> {
    await Promise.all(
      this.sourcePaseos
        .splice(0)
        .reverse()
        .map((source) => source.stop()),
    );
    const applications = this.running.splice(0).reverse();
    await Promise.all(
      applications.map(async (application) => {
        await stopServer(application.server);
        await stopProxy(application.proxy);
        await Promise.all(application.portLeases.map((lease) => lease.release()));
        await rm(application.dataDirectory, { recursive: true, force: true });
        if (application.tlsRoot !== undefined) {
          await rm(application.tlsRoot, { recursive: true, force: true });
        }
      }),
    );
  }

  async startSourcePaseo(): Promise<SourcePaseo> {
    const source = await SourcePaseo.start();
    this.sourcePaseos.push(source);
    return source;
  }
}

interface RunningApplication extends BuiltApplication {
  dataDirectory: string;
  portLeases: readonly PortLease[];
  server: ChildProcess;
  tlsRoot?: string;
  proxy?: Server;
}

interface ApplicationEnvironmentInput {
  dataDirectory: string;
  origin: string;
  appUrl?: string;
  port: number;
  registrationMode?: BuiltApplicationOptions["registrationMode"];
  organizationCreation?: BuiltApplicationOptions["organizationCreation"];
  browserAuth?: boolean;
  machineAuth?: boolean;
  providerConnections?: boolean;
  githubApprovalRequired?: boolean;
  providerScenario?: BrowserProviderScenario;
  providerApplications?: boolean;
  environmentApps?: readonly ("github" | "slack" | "discord" | "linear")[];
  machineKeyFile: string;
  databaseProfile?: BuiltApplicationOptions["databaseProfile"];
  bootstrap?: BuiltApplicationOptions["bootstrap"];
  billing?: BuiltApplicationOptions["billing"];
  tls?: TestTls;
  reverseProxy?: boolean;
}

function applicationEnvironment(input: ApplicationEnvironmentInput): NodeJS.ProcessEnv {
  const browserAuthEnabled = input.browserAuth !== false;
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(input.port),
    PASEO_HUB_BIND: "127.0.0.1",
    PASEO_REGISTRATION_MODE:
      input.registrationMode ?? (input.bootstrap === undefined ? "open" : "invite_only"),
    PASEO_ORGANIZATION_CREATION:
      input.organizationCreation ?? (input.bootstrap === undefined ? "open" : "disabled"),
    PASEO_HUB_AUTH_SECRET: browserAuthEnabled
      ? "phase-zero-playwright-secret-at-least-32-characters"
      : `phase-zero-isolated-disabled-auth-${randomUUID()}`,
    PASEO_BROWSER_AUTH_ENABLED: String(browserAuthEnabled),
    PASEO_MACHINE_AUTH_ENABLED: String(input.machineAuth !== false),
    PASEO_E2E_MACHINE_KEY_FILE: input.machineKeyFile,
    PASEO_E2E_DATABASE_PROFILE: input.databaseProfile ?? "legacy",
    GITHUB_WEBHOOK_SECRET: "phase-zero-webhook-secret",
    PASEO_E2E_SLACK_SIGNING_SECRET: "phase-zero-slack-webhook-secret",
    STRIPE_WEBHOOK_SECRET: "whsec_phase_zero_fixture_secret",
    PASEO_BROWSER_BILLING_SCENARIO: input.billing === true ? "configured" : "unconfigured",
    PASEO_BROWSER_PROVIDER_SCENARIO:
      input.providerScenario ??
      (input.providerConnections === false
        ? "not-configured"
        : input.githubApprovalRequired === true
          ? "approval"
          : "connected"),
    PASEO_BROWSER_PROVIDER_APPS: input.providerApplications === true ? "dynamic" : "static",
    ...(input.reverseProxy === true
      ? { PASEO_HUB_TRUSTED_CLIENT_IP_HEADER: "x-paseo-e2e-client-ip" }
      : {}),
    ...(input.tls === undefined
      ? {}
      : { PASEO_E2E_TLS_KEY: input.tls.key, PASEO_E2E_TLS_CERT: input.tls.cert }),
    ...environmentAppVariables(input.environmentApps ?? []),
    ...(input.bootstrap === undefined
      ? {}
      : {
          PASEO_BOOTSTRAP_ORGANIZATION: input.bootstrap.organizationName,
          PASEO_BOOTSTRAP_OWNER_EMAIL: input.bootstrap.ownerEmail,
          PASEO_BOOTSTRAP_OWNER_PASSWORD: input.bootstrap.ownerPassword,
        }),
  };
  delete environment["DATABASE_URL"];
  environment["PASEO_HUB_DATA_DIR"] = input.dataDirectory;
  if (input.appUrl === undefined) delete environment["PASEO_HUB_APP_URL"];
  else environment["PASEO_HUB_APP_URL"] = input.appUrl;
  return environment;
}

interface TestTls {
  root: string;
  key: string;
  cert: string;
}

const execFileAsync = promisify(execFile);

async function createTestTls(): Promise<TestTls> {
  const root = await mkdtemp(join(tmpdir(), "paseo-e2e-tls-"));
  const key = join(root, "localhost-key.pem");
  const cert = join(root, "localhost-cert.pem");
  await execFileAsync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    cert,
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ]);
  return { root, key, cert };
}

/**
 * Environment-managed apps, spelled with the same variables an operator would set. The fixture
 * credentials match the fixture providers, so an environment-managed provider is genuinely
 * connectable — read-only in the UI is a product rule, not a broken app.
 */
function environmentAppVariables(
  providers: readonly ("github" | "slack" | "discord" | "linear")[],
): NodeJS.ProcessEnv {
  const variables: NodeJS.ProcessEnv = {};
  if (providers.includes("github")) {
    variables["GITHUB_APP_ID"] = "42";
    variables["GITHUB_APP_SLUG"] = "paseo";
    variables["GITHUB_APP_CLIENT_ID"] = "client";
    variables["GITHUB_APP_CLIENT_SECRET"] = "secret";
    variables["GITHUB_APP_PRIVATE_KEY"] = "fixture-private-key";
  }
  if (providers.includes("discord")) {
    variables["DISCORD_CLIENT_ID"] = "900";
    variables["DISCORD_CLIENT_SECRET"] = "secret";
    variables["DISCORD_BOT_TOKEN"] = "token";
  }
  if (providers.includes("slack")) {
    variables["SLACK_TRANSPORT"] = "webhook";
    variables["SLACK_APP_ID"] = "browser-slack-app";
    variables["SLACK_CLIENT_ID"] = "browser-slack-client";
    variables["SLACK_CLIENT_SECRET"] = "browser-slack-client-secret";
    variables["SLACK_SIGNING_SECRET"] = "phase-zero-slack-webhook-secret";
  }
  if (providers.includes("linear")) {
    variables["LINEAR_CLIENT_ID"] = "browser-linear-client";
    variables["LINEAR_CLIENT_SECRET"] = "browser-linear-client-secret";
    variables["LINEAR_WEBHOOK_SECRET"] = "browser-linear-webhook-secret";
  }
  return variables;
}

async function deliverDiscord(server: ChildProcess, event: BrowserDiscordEvent): Promise<void> {
  await deliverCommand(server, { type: "discord", event });
}

async function deliverCommand(
  server: ChildProcess,
  command: Record<string, unknown>,
): Promise<void> {
  await deliverCommandForData(server, command);
}

/** Like `deliverCommand`, but resolves with the reply's `data` payload for inspection commands. */
async function deliverCommandForData(
  server: ChildProcess,
  command: Record<string, unknown>,
): Promise<unknown> {
  const id = randomUUID();
  const result = new Promise<unknown>((resolve, reject) => {
    const receive = (message: unknown) => {
      if (typeof message !== "object" || message === null || Reflect.get(message, "id") !== id) {
        return;
      }
      server.off("message", receive);
      if (Reflect.get(message, "ok") === true) resolve(Reflect.get(message, "data"));
      else reject(new Error(String(Reflect.get(message, "error"))));
    };
    server.on("message", receive);
  });
  server.send({ id, ...command });
  return result;
}

async function serverReady(server: ChildProcess, origin: string, output: string[]): Promise<void> {
  server.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  server.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`built application exited before readiness\n${output.join("")}`);
    }
    try {
      if (await healthReady(origin)) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`built application did not become ready\n${output.join("")}`);
}

async function healthReady(origin: string): Promise<boolean> {
  if (!origin.startsWith("https://")) return (await fetch(`${origin}/health`)).status === 200;
  return await new Promise<boolean>((resolve, reject) => {
    const request = httpsGet(`${origin}/health`, { rejectUnauthorized: false }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.once("error", reject);
  });
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => server.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

async function startReverseProxy(
  portLease: PortLease,
  targetPort: number,
  tls: TestTls,
): Promise<Server> {
  const proxy = createHttpsServer(
    { key: await readFile(tls.key, "utf8"), cert: await readFile(tls.cert, "utf8") },
    (incoming, outgoing) => {
      const upstream = httpRequest(
        {
          hostname: "127.0.0.1",
          port: targetPort,
          method: incoming.method,
          path: incoming.url,
          headers: {
            ...incoming.headers,
            host: `127.0.0.1:${targetPort}`,
            "x-forwarded-host": incoming.headers.host,
            "x-forwarded-proto": "https",
            "x-paseo-e2e-client-ip": "127.0.0.1",
          },
        },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.once("error", () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end("Bad Gateway");
      });
      incoming.pipe(upstream);
    },
  );
  await new Promise<void>((resolve, reject) => {
    proxy.once("error", reject);
    void portLease
      .handoff()
      .then(() => proxy.listen(portLease.port, "127.0.0.1", resolve))
      .catch(reject);
  });
  return proxy;
}

async function stopProxy(proxy: Server | undefined): Promise<void> {
  if (proxy === undefined) return;
  proxy.closeIdleConnections();
  proxy.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    proxy.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

interface PortLease {
  port: number;
  handoff(): Promise<void>;
  reacquire(): Promise<void>;
  release(): Promise<void>;
}

const PORT_LEASE_DIRECTORY = join(process.cwd(), "test-results", "port-leases");

async function reservePort(): Promise<PortLease> {
  await mkdir(PORT_LEASE_DIRECTORY, { recursive: true });
  while (true) {
    const server = createPortReservationServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      await closeServer(server);
      throw new Error("failed to allocate port");
    }
    const leasePath = join(PORT_LEASE_DIRECTORY, String(address.port));
    try {
      const lease = await open(leasePath, "wx");
      await lease.close();
    } catch (error) {
      await closeServer(server);
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    let reservation: NetServer | undefined = server;
    const handoff = async () => {
      if (reservation === undefined) return;
      const held = reservation;
      reservation = undefined;
      await closeServer(held);
    };
    return {
      port: address.port,
      handoff,
      reacquire: async () => {
        if (reservation !== undefined) throw new Error(`port ${address.port} is already reserved`);
        const next = createPortReservationServer();
        await new Promise<void>((resolve, reject) => {
          next.once("error", reject);
          next.listen(address.port, "127.0.0.1", resolve);
        });
        reservation = next;
      },
      release: async () => {
        await handoff();
        await unlink(leasePath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      },
    };
  }
}

function createPortReservationServer(): NetServer {
  return createServer((socket) => socket.destroy());
}

async function handoffPortWhenRequested(server: ChildProcess, lease: PortLease): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onExit = () => finish(new Error("built application exited before requesting its port"));
    const onMessage = (message: unknown) => {
      if (
        typeof message !== "object" ||
        message === null ||
        Reflect.get(message, "type") !== "port-handoff-request"
      ) {
        return;
      }
      cleanup();
      void lease.handoff().then(
        () =>
          server.send({ type: "port-handoff-ready" }, (error) => {
            error === null ? resolve() : reject(error);
          }),
        reject,
      );
    };
    const cleanup = () => {
      server.off("exit", onExit);
      server.off("message", onMessage);
    };
    const finish = (error: Error) => {
      cleanup();
      reject(error);
    };
    server.once("exit", onExit);
    server.on("message", onMessage);
  });
}

async function closeServer(server: NetServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
