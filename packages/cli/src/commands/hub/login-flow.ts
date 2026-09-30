import type { HubEnrollmentRequest } from "@clisbot/protocol/messages";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import type { HubHttpClient } from "./hub-client/index.js";

export interface LoginWaiter {
  wait(milliseconds: number): Promise<void>;
  now(): number;
}

export interface BrowserOpener {
  open(url: string): Promise<void>;
}

type BrowserLaunch = (command: string, args: string[]) => Promise<void>;

interface SystemBrowserOptions {
  hostPlatform?: NodeJS.Platform;
  launch?: BrowserLaunch;
}

export class SystemBrowser implements BrowserOpener {
  private readonly hostPlatform: NodeJS.Platform;
  private readonly launch: BrowserLaunch;

  constructor(options: SystemBrowserOptions = {}) {
    this.hostPlatform = options.hostPlatform ?? platform();
    this.launch = options.launch ?? launchDetached;
  }

  async open(url: string): Promise<void> {
    if (this.hostPlatform === "win32") {
      await this.launch("rundll32.exe", ["url.dll,FileProtocolHandler", url]);
      return;
    }
    await this.launch(this.hostPlatform === "darwin" ? "open" : "xdg-open", [url]);
  }
}

interface CliLoginFlowOptions {
  hub: Pick<HubHttpClient, "startCliAuthorization" | "pollCliAuthorization">;
  waiter: LoginWaiter;
  browser: BrowserOpener;
  instructions(verificationUri: string, userCode: string): void;
  openBrowser: boolean;
}

export class CliLoginFlow {
  constructor(private readonly options: CliLoginFlowOptions) {}

  async authorize(origin: string): Promise<string> {
    const outcome = await this.authorizeRequest(origin);
    if (outcome.status !== "authorized")
      throw new Error("Hub returned the wrong authorization purpose");
    return outcome.credential;
  }

  async authorizeEnrollment(origin: string, enrollment: HubEnrollmentRequest): Promise<string> {
    const outcome = await this.authorizeRequest(origin, enrollment);
    if (outcome.status !== "enrollment_authorized")
      throw new Error("Hub returned the wrong authorization purpose");
    return outcome.token;
  }

  private async authorizeRequest(origin: string, enrollment?: HubEnrollmentRequest) {
    const authorization = await this.options.hub.startCliAuthorization(origin, enrollment);
    const action = enrollment ? "Host connection approval" : "Hub CLI login";
    this.options.instructions(authorization.verificationUriComplete, authorization.userCode);
    if (this.options.openBrowser) {
      await this.options.browser.open(authorization.verificationUriComplete).catch(() => undefined);
    }
    let interval = authorization.interval;
    const expiresAt = Date.parse(authorization.expiresAt);
    while (true) {
      const remaining = expiresAt - this.options.waiter.now();
      if (remaining <= 0) throw new Error(`${action} expired`);
      await this.options.waiter.wait(Math.min(interval * 1_000, remaining));
      const pollLifetime = expiresAt - this.options.waiter.now();
      if (pollLifetime <= 0) throw new Error(`${action} expired`);
      const outcome = await this.options.hub.pollCliAuthorization(
        origin,
        authorization.deviceCode,
        pollLifetime,
        enrollment ? "host_enrollment" : undefined,
      );
      if (outcome.status === "authorized" || outcome.status === "enrollment_authorized")
        return outcome;
      if (outcome.status === "denied") throw new Error(`${action} was denied`);
      if (outcome.status === "expired") throw new Error(`${action} expired`);
      if (outcome.status === "disclosed")
        throw new Error(`${action} was already completed; start the command again`);
      if (outcome.status !== "retry_later") interval = outcome.interval;
    }
  }
}

export function createCliLoginFlow(
  hub: Pick<HubHttpClient, "startCliAuthorization" | "pollCliAuthorization">,
): CliLoginFlow {
  return new CliLoginFlow({
    hub,
    waiter: {
      wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      now: Date.now,
    },
    browser: new SystemBrowser(),
    instructions(verificationUri, userCode) {
      process.stderr.write(`Open ${verificationUri}\nCode (if asked): ${userCode}\n`);
    },
    openBrowser: process.stderr.isTTY === true,
  });
}

async function launchDetached(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, shell: false, stdio: "ignore" });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
    child.once("error", reject);
  });
}
