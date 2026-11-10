import { compare, hashSync } from "bcryptjs";
import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { RequestHandler } from "express";
import { matchesLocalCredential } from "./local-credential.js";
import type { DeviceAuthority } from "@clisbot/device-access/authority";
import type { ManagedAccessMode } from "@clisbot/protocol/managed-access";

export const DAEMON_PASSWORD_BCRYPT_COST = 12;

export interface DaemonAuthConfig {
  deviceAuthority?: DeviceAuthority;
  password?: string;
  localCredential?: () => string | null;
}

export interface BearerAuthRejectContext {
  path: string;
  method: string;
  hasToken: boolean;
}

interface BearerValidationInput {
  password: string | undefined;
  token: string | null;
}

export async function isBearerTokenValidAsync(input: BearerValidationInput): Promise<boolean> {
  if (!input.password) {
    return true;
  }
  if (input.token === null) {
    return false;
  }

  return compare(input.token, input.password);
}

export function hashDaemonPassword(password: string): string {
  return hashSync(password, DAEMON_PASSWORD_BCRYPT_COST);
}

export function extractHttpBearerToken(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const [scheme, ...tokenParts] = value.trim().split(/\s+/);
  if (scheme !== "Bearer" || tokenParts.length !== 1) {
    return null;
  }
  return tokenParts[0] ?? null;
}

export function extractWsBearerProtocol(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  for (const protocol of value.split(",")) {
    const trimmed = protocol.trim();
    const segments = trimmed.split(".");
    if (segments[0] === "clisbot" && segments[1] === "bearer" && segments.length >= 3) {
      return trimmed;
    }
  }

  return null;
}

export function extractWsBearerToken(protocol: string | null): string | null {
  if (!protocol) {
    return null;
  }
  const segments = protocol.split(".");
  if (segments[0] !== "clisbot" || segments[1] !== "bearer" || segments.length < 3) {
    return null;
  }
  return segments.slice(2).join(".");
}

export function createRequireBearerMiddleware(
  auth: DaemonAuthConfig | undefined,
  onReject?: (context: BearerAuthRejectContext) => void,
): RequestHandler {
  const password = auth?.password;
  return (req, res, next) => {
    if (auth?.deviceAuthority || !password || shouldBypassBearerAuth(req.method, req.path)) {
      next();
      return;
    }

    void (async () => {
      try {
        const token = extractHttpBearerToken(req.header("authorization"));
        const localCredential = req.path === "/api/status" ? auth?.localCredential?.() : null;
        const isLocal =
          localCredential !== null &&
          localCredential !== undefined &&
          token !== null &&
          matchesLocalCredential(localCredential, token);
        if (!isLocal && !(await isBearerTokenValidAsync({ password, token }))) {
          onReject?.({
            path: req.path,
            method: req.method,
            hasToken: token !== null,
          });
          res.status(401).json({ error: "Unauthorized" });
          return;
        }

        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}

/**
 * Routes exempt from the daemon-password middleware. Each one checks its own credential:
 * `/api/files/download` a single-use download token, `/mcp/agents` the per-run agent
 * capability token or the daemon password (classifyAgentMcpRequestAuthority).
 */
const SELF_AUTHENTICATING_ROUTES = new Set(["/api/files/download", "/mcp/agents"]);

/** Connectors relay routes check their own per-agent capability token (connectors/connector-relay.ts). */
const CONNECTORS_RELAY_PREFIX = "/mcp/connectors/";

function isBearerFreeRoute(path: string): boolean {
  return (
    path === "/api/health" ||
    SELF_AUTHENTICATING_ROUTES.has(path) ||
    path.startsWith(CONNECTORS_RELAY_PREFIX)
  );
}

export function shouldBypassBearerAuth(method: string, path: string): boolean {
  if (method === "OPTIONS") {
    return true;
  }
  return isBearerFreeRoute(path);
}

const LOOPBACK_SOCKET_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isLoopbackSocketAddress(remoteAddress: string | undefined): boolean {
  return remoteAddress !== undefined && LOOPBACK_SOCKET_ADDRESSES.has(remoteAddress);
}

/**
 * Headers reverse proxies and CDNs add; any of them means the loopback peer is a proxy, not the
 * caller. Every `x-forwarded-*` header counts, so a proxy that sets only `X-Forwarded-Proto` is
 * still recognised.
 */
const FORWARDING_HEADERS = new Set([
  "forwarded",
  "via",
  "x-real-ip",
  "x-client-ip",
  "x-cluster-client-ip",
  "true-client-ip",
  "cf-connecting-ip",
  "fastly-client-ip",
]);

function isForwardingHeader(name: string): boolean {
  return FORWARDING_HEADERS.has(name) || name.startsWith("x-forwarded-");
}

/**
 * True only for a request whose TCP peer is loopback and which carries no proxy forwarding
 * header. Reads the socket address, never `req.ip`, so the `trust proxy` setting cannot turn
 * a proxied request into a local one. A proxy that adds no forwarding header still looks
 * local, so this is a narrowing condition, never a credential on its own.
 */
export function isDirectLoopbackHttpRequest(req: {
  socket: { remoteAddress?: string };
  headers: IncomingHttpHeaders;
}): boolean {
  if (!isLoopbackSocketAddress(req.socket.remoteAddress)) return false;
  return !Object.keys(req.headers).some((name) => isForwardingHeader(name.toLowerCase()));
}

/** Credential authority is established once per HTTP request, never by callerAgentId. */
export type AgentMcpRequestAuthority =
  | "agent-capability"
  | "password-operator"
  | "legacy-anonymous"
  | "rejected";

interface AgentMcpRequestAuthInput {
  password: string | undefined;
  devicePairingEnabled?: boolean;
  /** `daemon.mcp.allowAnonymous`: explicit opt-in to tokenless callers on a no-password daemon. */
  allowAnonymous?: boolean;
  /** Current managed access mode; `external` never admits tokenless callers. */
  managedAccessMode?: ManagedAccessMode;
  /** isDirectLoopbackHttpRequest for this request; anonymous admission requires it. */
  directLoopback?: boolean;
  capabilityToken: string | null;
  authorizationHeader: string | undefined;
}

/**
 * Anonymous admission grants the full agent tool surface (terminals, agents, schedules) to a
 * caller that proved nothing, so it needs every guard at once: the explicit opt-in, managed
 * access not `external`, and a direct loopback request.
 */
function admitsLegacyAnonymous(input: AgentMcpRequestAuthInput): boolean {
  return (
    input.allowAnonymous === true &&
    input.managedAccessMode !== "external" &&
    input.directLoopback === true
  );
}

/**
 * The daemon's own agents present the injected capability token; operators may present the
 * daemon password. A no-password daemon rejects every other caller unless legacy anonymous
 * admission is explicitly enabled (admitsLegacyAnonymous).
 */
export async function classifyAgentMcpRequestAuthority(
  input: AgentMcpRequestAuthInput,
): Promise<AgentMcpRequestAuthority> {
  const token = extractHttpBearerToken(input.authorizationHeader);
  if (input.capabilityToken !== null && token !== null) {
    const provided = Buffer.from(token);
    const expected = Buffer.from(input.capabilityToken);
    if (provided.length === expected.length && timingSafeEqual(provided, expected))
      return "agent-capability";
  }
  // Pairing mode intentionally accepts only the injected agent capability here.
  if (input.devicePairingEnabled) return "rejected";
  // The generic password validator allows no-password daemons. That is admission
  // compatibility, not evidence that an HTTP caller owns an operator credential.
  if (!input.password) return admitsLegacyAnonymous(input) ? "legacy-anonymous" : "rejected";
  return (await isBearerTokenValidAsync({ password: input.password, token }))
    ? "password-operator"
    : "rejected";
}

/** Boolean admission API retained for existing consumers. */
export async function isAgentMcpRequestAuthorized(
  input: AgentMcpRequestAuthInput,
): Promise<boolean> {
  return (await classifyAgentMcpRequestAuthority(input)) !== "rejected";
}
