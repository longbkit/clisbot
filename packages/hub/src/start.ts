import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";

export const API_REFERENCE_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
].join("; ");

const apiReferenceSecurity = createMiddleware().server(async ({ next, request }) => {
  if (new URL(request.url).pathname === "/api/reference") {
    setResponseHeader("content-security-policy", API_REFERENCE_CSP);
  }
  return next();
});

const csrfMiddleware = createCsrfMiddleware({
  filter: ({ handlerType }) => handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [apiReferenceSecurity, csrfMiddleware],
}));
