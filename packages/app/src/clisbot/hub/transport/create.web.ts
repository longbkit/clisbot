import { getDesktopHost } from "@/desktop/host";
import type { HubConfiguration } from "../config";
import type { GoogleSignInContext, HubRequestInput, HubTransport } from "./contract";

export function createHubTransport(configuration: HubConfiguration): HubTransport {
  const bridge = getDesktopHost()?.hub;
  return bridge === undefined
    ? new BrowserHubTransport(configuration.origin)
    : new ElectronHubTransport(configuration.origin, bridge);
}

class BrowserHubTransport implements HubTransport {
  readonly signInKind = "password" as const;

  constructor(private readonly origin: string) {}

  request(path: string, input: HubRequestInput = {}): Promise<Response> {
    this.assertSameOrigin();
    return fetch(new URL(assertHubPath(path), this.origin), {
      method: input.method ?? "GET",
      credentials: "include",
      headers: input.headers,
      ...(input.body === undefined ? {} : { body: input.body }),
    });
  }

  async signIn(input?: { email: string; password: string }): Promise<void> {
    this.assertSameOrigin();
    if (input === undefined) throw new Error("Email and password are required.");
    const response = await fetch(new URL("/api/auth/sign-in/email", this.origin), {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (response.ok) return;
    const code: unknown = Reflect.get(Object(await response.json().catch(() => ({}))), "code");
    throw new Error(signInFailureMessage(code));
  }

  async signInWithGoogle(context?: GoogleSignInContext): Promise<void> {
    this.assertSameOrigin();
    const returnTo = new URL(context?.returnPath ?? window.location.href, window.location.href);
    returnTo.searchParams.delete("error");
    const response = await fetch(new URL("/api/auth/sign-in/social", this.origin), {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "google",
        callbackURL: `${returnTo.pathname}${returnTo.search}`,
        ...(context?.invitationId === undefined ? {} : { invitation: context.invitationId }),
        ...(context?.claimInstance === true ? { intent: "claimInstance" } : {}),
      }),
    });
    const url: unknown = Reflect.get(Object(await response.json().catch(() => ({}))), "url");
    if (!response.ok || typeof url !== "string") {
      throw new Error("Hub couldn't start Google sign-in.");
    }
    window.location.assign(url);
  }

  async signOut(): Promise<void> {
    this.assertSameOrigin();
    const response = await fetch(new URL("/api/auth/sign-out", this.origin), {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new Error("Hub sign-out failed.");
  }

  private assertSameOrigin(): void {
    if (window.location.origin !== this.origin) {
      throw new Error(
        "Browser Hub access requires the Paseo client to be served from the Hub origin.",
      );
    }
  }
}

type ElectronHubBridge = NonNullable<NonNullable<ReturnType<typeof getDesktopHost>>["hub"]>;

class ElectronHubTransport implements HubTransport {
  readonly signInKind = "system-browser" as const;

  constructor(
    private readonly origin: string,
    private readonly bridge: ElectronHubBridge,
  ) {}

  async request(path: string, input: HubRequestInput = {}): Promise<Response> {
    const result = await this.bridge.request?.({
      origin: this.origin,
      path: assertHubPath(path),
      ...input,
    });
    if (result === undefined) throw new Error("Desktop Hub bridge is unavailable.");
    return new Response(result.body, { status: result.status, headers: result.headers });
  }

  async signIn(
    _input?: { email: string; password: string },
    context?: { invitationId?: string },
  ): Promise<void> {
    if (this.bridge.signIn === undefined) throw new Error("Desktop Hub sign-in is unavailable.");
    await this.bridge.signIn({
      origin: this.origin,
      ...(context?.invitationId === undefined ? {} : { invitationId: context.invitationId }),
    });
  }

  async signOut(): Promise<void> {
    if (this.bridge.signOut === undefined) throw new Error("Desktop Hub sign-out is unavailable.");
    await this.bridge.signOut({ origin: this.origin });
  }
}

function signInFailureMessage(code: unknown): string {
  if (code === "registration_closed") {
    return "This account isn't admitted to this Hub. Ask an organization owner to invite you.";
  }
  return "The email or password is incorrect.";
}

function assertHubPath(path: string): string {
  if (!path.startsWith("/api/")) throw new Error("Hub requests must use an API path.");
  return path;
}
