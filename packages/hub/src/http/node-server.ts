import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { once } from "node:events";
import { isIP } from "node:net";
import type { Logger } from "pino";
import { logger as defaultLogger } from "../logger.js";
import {
  failureWasReported,
  reportFailure,
  runWithFailureTracking,
  withReference,
} from "../failures/index.js";
import { INTERNAL_CLIENT_ADDRESS_HEADER } from "./client-address.js";
import { takeResponseLifecycle } from "./response-lifecycle.js";
import { TRUSTED_REQUEST_ORIGIN_HEADER } from "./request-origin.js";

export type FetchHandler = (request: Request) => Response | Promise<Response>;

interface StreamingRequestInit extends RequestInit {
  duplex: "half";
}

interface FetchServerOptions {
  trustedClientIpHeader?: string;
  /** Explicit public URL whose origin is authoritative over proxy request metadata. */
  canonicalRequestOrigin?: string;
  /** Test and embedded adapters may terminate TLS directly; production normally uses its proxy. */
  tls?: { key: string; cert: string };
  logger?: Pick<Logger, "warn" | "error">;
}

export function createFetchServer(
  fetchHandler: FetchHandler,
  options: FetchServerOptions = {},
): Server {
  const resolvedOptions = {
    ...options,
    ...(options.canonicalRequestOrigin === undefined
      ? {}
      : { canonicalRequestOrigin: parseHttpOrigin(options.canonicalRequestOrigin) }),
  };
  const handler = (request: IncomingMessage, response: ServerResponse) => {
    void forwardRequest(fetchHandler, request, response, resolvedOptions);
  };
  return resolvedOptions.tls === undefined
    ? createServer(handler)
    : createHttpsServer(resolvedOptions.tls, handler);
}

async function forwardRequest(
  fetchHandler: FetchHandler,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  options: FetchServerOptions,
): Promise<void> {
  try {
    const clientAddress = resolveClientAddress(incoming, options.trustedClientIpHeader);
    const request = toRequest(incoming, clientAddress, options);
    const tracked = await runWithFailureTracking(async () => {
      const response = await fetchHandler(request);
      return { response, failureReported: failureWasReported() };
    }, options.logger);
    const { response } = tracked;
    let responseRequestId: string | undefined;
    if (response.status >= 400 && !tracked.failureReported) {
      responseRequestId = reportFailure(
        new Error(`HTTP response completed with status ${response.status}`),
        {
          operation: "http.response",
          component: "http",
          method: request.method,
          path: new URL(request.url).pathname,
          status: response.status,
        },
        {
          status: response.status,
          ...(options.logger === undefined ? {} : { logger: options.logger }),
        },
      ).requestId;
    }
    const lifecycle = takeResponseLifecycle(response);
    let responseForwarded = false;
    let lifecycleSettled = false;
    const runLifecycle = (callback: (() => void | Promise<void>) | undefined): void => {
      if (callback === undefined || lifecycleSettled) return;
      lifecycleSettled = true;
      void Promise.resolve(callback()).catch((error: unknown) => {
        reportFailure(
          error,
          { operation: "http.response.lifecycle", component: "http", method: request.method },
          options.logger === undefined ? {} : { logger: options.logger },
        );
      });
    };
    const abortLifecycle = (): void => {
      if (lifecycle === undefined) return;
      runLifecycle(lifecycle.onAbort);
    };
    if (lifecycle !== undefined) {
      outgoing.once("finish", () => {
        if (!responseForwarded) {
          abortLifecycle();
          return;
        }
        runLifecycle(lifecycle.onFinish);
      });
      const markResponseAborted = () => {
        if (outgoing.writableFinished) return;
        responseForwarded = false;
        abortLifecycle();
      };
      outgoing.once("close", markResponseAborted);
      outgoing.once("error", markResponseAborted);
    }
    outgoing.statusCode = response.status;
    outgoing.statusMessage = response.statusText;
    for (const [name, value] of response.headers) outgoing.setHeader(name, value);
    if (responseRequestId !== undefined) outgoing.setHeader("x-request-id", responseRequestId);
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) outgoing.setHeader("set-cookie", cookies);
    if (response.body === null) {
      responseForwarded = true;
      outgoing.end();
      return;
    }
    const reader = response.body.getReader();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!outgoing.write(chunk.value)) await once(outgoing, "drain");
    }
    responseForwarded = true;
    outgoing.end();
  } catch (error) {
    const path = safeRequestPath(incoming.url);
    const report = reportFailure(
      error,
      {
        operation: "http.request",
        component: "http",
        method: incoming.method ?? "GET",
        path,
      },
      { logger: options.logger ?? defaultLogger },
    );
    outgoing.statusCode = 500;
    outgoing.setHeader("x-request-id", report.requestId);
    if (path.startsWith("/api/")) {
      outgoing.setHeader("content-type", "application/json; charset=utf-8");
      outgoing.end(
        JSON.stringify({
          error: "internal_error",
          message: "Hub couldn't complete this API request.",
          requestId: report.requestId,
        }),
      );
      return;
    }
    outgoing.setHeader("content-type", "text/plain; charset=utf-8");
    outgoing.end(withReference("Hub couldn't complete this request.", report.requestId));
  }
}

function safeRequestPath(value: string | undefined): string {
  if (value === undefined) return "/";
  try {
    return new URL(value, "http://localhost").pathname;
  } catch {
    return "<invalid-path>";
  }
}

function toRequest(
  incoming: IncomingMessage,
  clientAddress: string,
  options: FetchServerOptions,
): Request {
  const method = incoming.method ?? "GET";
  const origin = `http://${incoming.headers.host ?? "localhost"}`;
  const headers = requestHeaders(incoming);
  headers.set(INTERNAL_CLIENT_ADDRESS_HEADER, clientAddress);
  headers.set(TRUSTED_REQUEST_ORIGIN_HEADER, requestOrigin(incoming, options));
  const base = { method, headers } satisfies RequestInit;
  if (method === "GET" || method === "HEAD") {
    return new Request(new URL(incoming.url ?? "/", origin), base);
  }
  const streaming = {
    ...base,
    body: requestBody(incoming),
    duplex: "half",
  } satisfies StreamingRequestInit;
  return new Request(new URL(incoming.url ?? "/", origin), streaming);
}

function resolveClientAddress(
  incoming: IncomingMessage,
  trustedClientIpHeader: string | undefined,
): string {
  const peerAddress = incoming.socket.remoteAddress ?? "unknown";
  if (trustedClientIpHeader === undefined) return peerAddress;
  const value = incoming.headers[trustedClientIpHeader.toLowerCase()];
  if (typeof value !== "string") return peerAddress;
  const address = value.trim();
  return isIP(address) === 0 ? peerAddress : address;
}

function requestBody(incoming: IncomingMessage): ReadableStream<Uint8Array> {
  let iterator: AsyncIterator<unknown> | undefined;
  const source = {
    type: "bytes",
    async pull(controller) {
      iterator ??= incoming[Symbol.asyncIterator]();
      try {
        const chunk = await iterator.next();
        if (chunk.done) {
          controller.close();
          return;
        }
        controller.enqueue(readChunk(chunk.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator?.return?.();
      incoming.destroy();
    },
  } satisfies UnderlyingByteSource;
  return new ReadableStream(source);
}

function readChunk(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  throw new TypeError("request body contained an unsupported chunk");
}

function requestHeaders(incoming: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  headers.delete(TRUSTED_REQUEST_ORIGIN_HEADER);
  return headers;
}

function requestOrigin(incoming: IncomingMessage, options: FetchServerOptions): string {
  if (options.canonicalRequestOrigin !== undefined) return options.canonicalRequestOrigin;
  const directProtocol = Reflect.get(incoming.socket, "encrypted") === true ? "https" : "http";
  const directHost = incoming.headers.host;
  if (options.trustedClientIpHeader === undefined) {
    return validatedOrigin(directProtocol, directHost);
  }
  const forwardedProtocol = firstForwardedValue(incoming.headers["x-forwarded-proto"]);
  const forwardedHost = firstForwardedValue(incoming.headers["x-forwarded-host"]);
  return forwardedProtocol === undefined || forwardedHost === undefined
    ? validatedOrigin(directProtocol, directHost)
    : validatedOrigin(forwardedProtocol, forwardedHost);
}

function parseHttpOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid origin");
  if (url.username !== "" || url.password !== "") throw new Error("invalid origin");
  return url.origin;
}

function firstForwardedValue(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value?.split(",", 1)[0];
  const normalized = first?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function validatedOrigin(protocol: string, host: string | undefined): string {
  if (protocol !== "http" && protocol !== "https") throw new Error("invalid request protocol");
  if (host === undefined || /[\\/@\s]/u.test(host)) throw new Error("invalid request authority");
  const url = new URL(`${protocol}://${host}`);
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error("invalid request authority");
  }
  return url.origin;
}
