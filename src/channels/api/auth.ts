import { createHmac, timingSafeEqual } from "node:crypto";
import type { ApiAuthConfig } from "./config.ts";

export type ApiAuthRequest = {
  headers: Headers;
  rawBody: string;
  remoteAddress?: string | null;
  now?: number;
  env?: NodeJS.ProcessEnv;
};

function getHeader(headers: Headers, name: string | undefined) {
  if (!name) {
    return "";
  }
  return headers.get(name) ?? headers.get(name.toLowerCase()) ?? "";
}

function getRequiredEnv(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

function isLoopbackAddress(address?: string | null) {
  if (!address) {
    return false;
  }
  return address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address === "localhost";
}

function renderSigningBase(template: string, params: { timestamp: string; rawBody: string }) {
  return template
    .replaceAll("{{timestamp}}", params.timestamp)
    .replaceAll("{{rawBody}}", params.rawBody);
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyHmac(config: Extract<ApiAuthConfig, { mode: "hmac" }>, request: ApiAuthRequest) {
  const env = request.env ?? process.env;
  const secret = getRequiredEnv(env, config.secretEnv);
  const timestamp = getHeader(request.headers, config.timestampHeader);
  const signature = getHeader(request.headers, config.signatureHeader);
  if (!signature) {
    return false;
  }
  if (config.timestampHeader) {
    if (!timestamp) {
      return false;
    }
    const parsed = Number(timestamp);
    const requestMs = Number.isFinite(parsed) && parsed < 10_000_000_000 ? parsed * 1000 : parsed;
    const toleranceSeconds = config.toleranceSecondsEnv && env[config.toleranceSecondsEnv]
      ? Number(env[config.toleranceSecondsEnv])
      : config.toleranceSecondsDefault ?? 300;
    if (!Number.isFinite(requestMs) || Math.abs((request.now ?? Date.now()) - requestMs) > toleranceSeconds * 1000) {
      return false;
    }
  }
  const base = renderSigningBase(config.signingBase ?? "{{timestamp}}.{{rawBody}}", {
    timestamp,
    rawBody: request.rawBody,
  });
  const expectedDigest = createHmac("sha256", secret).update(base).digest("hex");
  const expected = `${config.signaturePrefix ?? "sha256="}${expectedDigest}`;
  return safeEqual(signature, expected);
}

function verifyBearer(config: Extract<ApiAuthConfig, { mode: "bearer" }>, request: ApiAuthRequest) {
  const token = getRequiredEnv(request.env ?? process.env, config.tokenEnv);
  const headerName = config.header ?? "authorization";
  const headerValue = getHeader(request.headers, headerName).trim();
  if (!headerValue) {
    return false;
  }
  const scheme = config.scheme ?? "Bearer";
  if (headerName.toLowerCase() === "authorization") {
    const prefix = `${scheme} `;
    return headerValue.toLowerCase().startsWith(prefix.toLowerCase()) &&
      safeEqual(headerValue.slice(prefix.length).trim(), token);
  }
  return safeEqual(headerValue, token);
}

export function authorizeApiBotRequest(config: ApiAuthConfig, request: ApiAuthRequest) {
  if (config.mode === "hmac") {
    return verifyHmac(config, request);
  }
  if (config.mode === "bearer") {
    return verifyBearer(config, request);
  }
  return isLoopbackAddress(request.remoteAddress);
}
