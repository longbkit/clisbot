import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { BrowserOrganizationAccess } from "../auth/browser-organization-access.js";
import { CLI_CREDENTIAL_PREFIX, cliCredentialParts } from "../auth/cli-credentials.js";
import { ProductRequestError } from "../auth/organization-access.js";
import type { Database } from "../db/types.js";
import { INTERNAL_CLIENT_ADDRESS_HEADER } from "../http/client-address.js";
import { reportFailure } from "../failures/index.js";

const LIFETIME_SECONDS = 10 * 60;
const INITIAL_POLL_INTERVAL_SECONDS = 5;
const PER_FINGERPRINT_LIMIT = 5;
const GLOBAL_LIMIT = 1_000;
const emptyBody = z.object({}).strict();
const pollBody = z.object({ deviceCode: z.string().min(32).max(200) }).strict();
const codeBody = z.object({ userCode: z.string().min(1).max(40) }).strict();
const decisionBody = codeBody
  .extend({
    decision: z.enum(["approve", "deny"]),
    organizationId: z.string().min(1),
  })
  .strict();

export class CliAuthorizations {
  constructor(
    private readonly database: Database,
    private readonly access: BrowserOrganizationAccess | undefined,
    private readonly publicBaseUrl?: string,
  ) {}

  async start(request: Request): Promise<Response> {
    const input = emptyBody.safeParse(
      await this.parsedJson(request, "cli_authorization.start.parse"),
    );
    if (!input.success) return invalidRequest();
    const deviceCode = randomBytes(32).toString("base64url");
    const userCode = formatUserCode(base32(randomBytes(8)));
    const authorization = await this.database.startCliAuthorization({
      id: randomUUID(),
      deviceVerifier: verifier(deviceCode),
      userCodeVerifier: verifier(normalizeUserCode(userCode)),
      fingerprintVerifier: verifier(
        request.headers.get(INTERNAL_CLIENT_ADDRESS_HEADER) ?? "unknown",
      ),
      lifetimeSeconds: LIFETIME_SECONDS,
      pollIntervalSeconds: INITIAL_POLL_INTERVAL_SECONDS,
      perFingerprintLimit: PER_FINGERPRINT_LIMIT,
      globalLimit: GLOBAL_LIMIT,
    });
    if (authorization === undefined) {
      return Response.json(
        { status: "retry_later", interval: INITIAL_POLL_INTERVAL_SECONDS },
        {
          status: 429,
          headers: { "retry-after": String(INITIAL_POLL_INTERVAL_SECONDS) },
        },
      );
    }
    const verificationUri = new URL("/cli-login", this.publicBaseUrl ?? request.url);
    const verificationUriComplete = new URL(verificationUri);
    verificationUriComplete.searchParams.set("code", userCode);
    return Response.json(
      {
        deviceCode,
        userCode,
        verificationUri: verificationUri.toString(),
        verificationUriComplete: verificationUriComplete.toString(),
        expiresAt: authorization.expiresAt.toISOString(),
        interval: authorization.pollIntervalSeconds,
      },
      { status: 201 },
    );
  }

  async poll(request: Request): Promise<Response> {
    const input = pollBody.safeParse(
      await this.parsedJson(request, "cli_authorization.poll.parse"),
    );
    if (!input.success) return invalidRequest();
    const credential = deriveCredential(input.data.deviceCode);
    const outcome = await this.database.pollCliAuthorization({
      deviceVerifier: verifier(input.data.deviceCode),
      credential: { id: randomUUID(), ...cliCredentialParts(credential) },
    });
    return Response.json({
      status: outcome.status,
      interval: outcome.intervalSeconds,
      ...(outcome.status === "authorized"
        ? { credential, organizationId: outcome.organizationId }
        : {}),
    });
  }

  async inspect(request: Request): Promise<Response> {
    const access = await this.browserAccess(request, true);
    if (access instanceof Response) return access;
    const input = codeBody.safeParse(
      await this.parsedJson(request, "cli_authorization.inspect.parse"),
    );
    if (!input.success) return invalidRequest();
    const authorization = await this.database.inspectCliAuthorization(
      verifier(normalizeUserCode(input.data.userCode)),
    );
    if (authorization === undefined) return unavailable();
    return Response.json({
      expiresAt: authorization.expiresAt.toISOString(),
      organization: access.organization,
      canManage: access.capabilities.manageResources,
    });
  }

  async decide(request: Request): Promise<Response> {
    const access = await this.browserAccess(request, true);
    if (access instanceof Response) return access;
    if (!access.capabilities.manageResources) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const input = decisionBody.safeParse(
      await this.parsedJson(request, "cli_authorization.decide.parse"),
    );
    if (!input.success) return invalidRequest();
    if (input.data.organizationId !== access.organization.id) {
      return Response.json({ error: "organization_required" }, { status: 403 });
    }
    const outcome = await this.database.decideCliAuthorization({
      userCodeVerifier: verifier(normalizeUserCode(input.data.userCode)),
      decision: input.data.decision,
      access: {
        sessionId: access.session.id,
        userId: access.account.id,
        membershipId: access.membership.id,
        organizationId: access.organization.id,
      },
    });
    if (outcome === "unavailable") return unavailable();
    if (outcome === "forbidden") {
      return Response.json({ error: "organization_required" }, { status: 403 });
    }
    return Response.json({ status: outcome });
  }

  private async browserAccess(request: Request, mutation: boolean) {
    if (this.access === undefined) {
      return Response.json({ error: "auth_unavailable" }, { status: 503 });
    }
    if (mutation) {
      const rejected = this.access.rejectCookieMutation(request);
      if (rejected !== undefined) return rejected;
    }
    try {
      return await this.access.resolveOrganizationAccess(request);
    } catch (error) {
      if (error instanceof ProductRequestError) return error.response();
      throw error;
    }
  }

  private async parsedJson(request: Request, operation: string): Promise<unknown> {
    try {
      return await request.json();
    } catch (error) {
      reportFailure(error, { operation, component: "cli_authorizations" }, { kind: "validation" });
      return undefined;
    }
  }
}

export function normalizeUserCode(value: string): string {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z2-7]/gu, "");
}

function deriveCredential(deviceCode: string): string {
  const prefix = `${CLI_CREDENTIAL_PREFIX}${createHash("sha256")
    .update("paseo-cli-prefix\0")
    .update(deviceCode)
    .digest("base64url")
    .slice(0, 12)}`;
  const secret = createHash("sha256")
    .update("paseo-cli-credential\0")
    .update(deviceCode)
    .digest("base64url");
  return `${prefix}_${secret}`;
}

function verifier(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function base32(value: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let buffer = 0;
  let result = "";
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) result += alphabet[(buffer << (5 - bits)) & 31];
  return result;
}

function formatUserCode(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8)}`;
}

function invalidRequest(): Response {
  return Response.json({ error: "invalid_request" }, { status: 400 });
}

function unavailable(): Response {
  return Response.json({ error: "authorization_unavailable" }, { status: 404 });
}
