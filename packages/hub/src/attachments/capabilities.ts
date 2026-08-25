import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  AttachmentProvider,
  AttachmentRecord,
  Database,
  InsertAttachmentInput,
} from "../db/types.js";
import { reportFailure, withReference, type FailureKind } from "../failures/index.js";

export type { AttachmentProvider } from "../db/types.js";

const SIGNING_DOMAIN = "paseo-hub/attachment-download/v1";
const DEFAULT_LIFETIME_SECONDS = 15 * 60;
const MAX_FILENAME_LENGTH = 255;
const MAX_SOURCE_ID_LENGTH = 255;

export interface AttachmentReference {
  id: string;
  filename: string;
  content_type: string | null;
  size: number | null;
}

export interface AttachmentDescriptor extends AttachmentReference {
  url: string;
}

export interface AttachmentResolverInput {
  executionId?: string;
  organizationId: string;
  connectionId: string;
  locator: unknown;
}

export type AttachmentResolver = (input: AttachmentResolverInput) => Promise<Response>;

export interface AttachmentCapabilityRegistration extends InsertAttachmentInput {}

export interface AttachmentCapabilityRegistry {
  register(input: AttachmentCapabilityRegistration): Promise<AttachmentReference>;
  materialize(reference: AttachmentReference, executionId: string): AttachmentDescriptor;
  urlFor(attachmentId: string, executionId: string): string;
  handle(request: Request, executionId: string, attachmentId: string): Promise<Response>;
}

export function createAttachmentCapabilityRegistry(options: {
  database: Database;
  publicBaseUrl: string;
  authoritySecret: string;
  resolvers: Partial<Record<AttachmentProvider, AttachmentResolver>>;
  now?: () => Date;
  lifetimeSeconds?: number;
}): AttachmentCapabilityRegistry {
  const now = options.now ?? (() => new Date());
  const lifetimeSeconds = options.lifetimeSeconds ?? DEFAULT_LIFETIME_SECONDS;
  if (!Number.isSafeInteger(lifetimeSeconds) || lifetimeSeconds <= 0) {
    throw new Error("attachment capability lifetime must be a positive integer");
  }

  return {
    async register(input) {
      validateRegistration(input);
      const existing = await options.database.findAttachmentBySource(
        input.providerEventReceiptId,
        input.provider,
        input.sourceId,
      );
      const record =
        existing ??
        (await options.database.insertAttachment({
          ...input,
          contentType: input.contentType ?? null,
          byteSize: input.byteSize ?? null,
        }));
      return toReference(record);
    },

    materialize(reference, executionId) {
      return {
        ...reference,
        url: urlFor(reference.id, executionId, options, now),
      };
    },

    urlFor(attachmentId, executionId) {
      return urlFor(attachmentId, executionId, options, now);
    },

    async handle(request, executionId, attachmentId) {
      if (request.method !== "GET") {
        return attachmentFailure(
          new Error("attachment method is not allowed"),
          executionId,
          "validation",
          405,
          "Attachment links must be opened with GET.",
        );
      }
      const capability = readCapability(request, attachmentId, executionId, options, now);
      if (capability === undefined) {
        return attachmentFailure(
          new Error("attachment capability is invalid or expired"),
          executionId,
          "notFound",
          404,
          "Attachment unavailable or link expired. Request a new attachment link.",
        );
      }

      const execution = await options.database.findAgentExecutionById(executionId);
      if (
        execution === undefined ||
        (execution.status !== "spawning" && execution.status !== "running")
      ) {
        return attachmentFailure(
          new Error("attachment execution is not live"),
          executionId,
          "notFound",
          404,
          "Attachment unavailable or link expired. Request a new attachment link.",
        );
      }
      const attachment = await options.database.findAttachmentForExecution(
        executionId,
        attachmentId,
      );
      if (attachment === undefined) {
        return attachmentFailure(
          new Error("attachment record is unavailable"),
          executionId,
          "notFound",
          404,
          "Attachment unavailable or link expired. Request a new attachment link.",
        );
      }

      const resolver = options.resolvers[attachment.provider];
      if (resolver === undefined) {
        return attachmentFailure(
          new Error("attachment provider resolver is unavailable"),
          executionId,
          "internal",
          502,
          "Hub cannot retrieve this attachment because its provider is unavailable.",
        );
      }
      let upstream: Response;
      try {
        upstream = await resolver({
          executionId,
          organizationId: attachment.organizationId,
          connectionId: attachment.connectionId,
          locator: attachment.locator,
        });
      } catch (error) {
        return attachmentFailure(
          error,
          executionId,
          "network",
          502,
          "Hub couldn't retrieve this attachment from its provider. Check the provider connection.",
        );
      }
      if (!upstream.ok) {
        const limited = upstream.status === 429;
        return attachmentFailure(
          new Error(`attachment provider returned HTTP ${upstream.status}`),
          executionId,
          limited ? "rateLimited" : "upstreamUnavailable",
          502,
          limited
            ? "The attachment provider rate limited Hub. Wait before requesting a new link."
            : "The attachment provider couldn't return this file. Check the provider connection and request a new link.",
        );
      }

      const headers = new Headers();
      const upstreamIsEncoded = upstream.headers.has("content-encoding");
      copyHeader(upstream.headers, headers, "content-type");
      if (!upstreamIsEncoded) copyHeader(upstream.headers, headers, "content-length");
      copyHeader(upstream.headers, headers, "etag");
      copyHeader(upstream.headers, headers, "last-modified");
      if (!headers.has("content-type") && attachment.contentType !== null) {
        headers.set("content-type", attachment.contentType);
      }
      if (!upstreamIsEncoded && !headers.has("content-length") && attachment.byteSize !== null) {
        headers.set("content-length", String(attachment.byteSize));
      }
      headers.set("content-disposition", contentDisposition(attachment.filename));
      headers.set("cache-control", "no-store");
      return new Response(upstream.body, { status: 200, headers });
    },
  };
}

function attachmentFailure(
  error: unknown,
  executionId: string,
  kind: FailureKind,
  status: number,
  message: string,
): Response {
  const report = reportFailure(
    error,
    { operation: "attachment.retrieve", component: "attachments", executionId, status },
    { kind },
  );
  const correlated = ["network", "rateLimited", "upstreamUnavailable", "internal"].includes(kind);
  return new Response(correlated ? withReference(message, report.requestId) : message, {
    status,
  });
}

function toReference(record: AttachmentRecord): AttachmentReference {
  return {
    id: record.id,
    filename: record.filename,
    content_type: record.contentType,
    size: record.byteSize,
  };
}

function validateRegistration(input: AttachmentCapabilityRegistration): void {
  if (input.providerEventReceiptId.length === 0 || input.organizationId.length === 0) {
    throw new Error("attachment ownership is required");
  }
  if (input.connectionId.length === 0) throw new Error("attachment connection is required");
  if (!/^[a-z]+$/u.test(input.provider)) throw new Error("invalid attachment provider");
  if (input.sourceId.length === 0 || input.sourceId.length > MAX_SOURCE_ID_LENGTH) {
    throw new Error("invalid attachment source id");
  }
  if (input.filename.length === 0 || input.filename.length > MAX_FILENAME_LENGTH) {
    throw new Error("invalid attachment filename");
  }
  if (
    input.contentType !== undefined &&
    input.contentType !== null &&
    input.contentType.length > 255
  ) {
    throw new Error("invalid attachment content type");
  }
  if (
    input.byteSize !== undefined &&
    input.byteSize !== null &&
    (!Number.isSafeInteger(input.byteSize) || input.byteSize < 0)
  ) {
    throw new Error("invalid attachment byte size");
  }
}

function urlFor(
  attachmentId: string,
  executionId: string,
  options: {
    publicBaseUrl: string;
    authoritySecret: string;
    lifetimeSeconds?: number;
  },
  now: () => Date,
): string {
  const expires =
    Math.floor(now().getTime() / 1_000) + (options.lifetimeSeconds ?? DEFAULT_LIFETIME_SECONDS);
  const signature = sign(options.authoritySecret, attachmentId, executionId, expires);
  const url = new URL(
    `/agent-executions/${encodeURIComponent(executionId)}/attachments/${encodeURIComponent(attachmentId)}`,
    options.publicBaseUrl,
  );
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);
  return url.toString();
}

function readCapability(
  request: Request,
  attachmentId: string,
  executionId: string,
  options: { authoritySecret: string },
  now: () => Date,
): { expires: number } | undefined {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return undefined;
  }
  const expiresText = url.searchParams.get("expires");
  const signature = url.searchParams.get("signature");
  if (expiresText === null || signature === null || !/^\d+$/u.test(expiresText)) return undefined;
  const expires = Number(expiresText);
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(now().getTime() / 1_000)) {
    return undefined;
  }
  const expected = sign(options.authoritySecret, attachmentId, executionId, expires);
  const actual = Buffer.from(signature, "base64url");
  const expectedBytes = Buffer.from(expected, "base64url");
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes)
    ? { expires }
    : undefined;
}

function sign(secret: string, attachmentId: string, executionId: string, expires: number): string {
  return createHmac("sha256", secret)
    .update(SIGNING_DOMAIN)
    .update("\0")
    .update(attachmentId)
    .update("\0")
    .update(executionId)
    .update("\0")
    .update(String(expires))
    .digest("base64url");
}

function copyHeader(source: Headers, target: Headers, name: string): void {
  const value = source.get(name);
  if (value !== null) target.set(name, value);
}

function contentDisposition(filename: string): string {
  const safe = filename
    .replaceAll(/[\r\n]/gu, "_")
    .replaceAll(/[^\x20-\x7e]/gu, "_")
    .replaceAll('"', "_")
    .slice(0, MAX_FILENAME_LENGTH);
  return `attachment; filename="${safe.length === 0 ? "attachment" : safe}"`;
}
