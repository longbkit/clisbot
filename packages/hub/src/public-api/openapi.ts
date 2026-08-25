import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import {
  CliAuthorizationPollSchema,
  CliAuthorizationSchema,
  PollCliAuthorizationRequestSchema,
  ProblemSchema,
  StartCliAuthorizationRequestSchema,
} from "./contracts.js";
import { publicOperationManifest } from "./operation-manifest.js";

const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "Paseo organization credential",
  description:
    "An organization API key or durable CLI login credential. Each operation requires the scope shown on the operation.",
});

registry.registerPath({
  method: "post",
  path: "/api/v1/cli-authorizations",
  operationId: "startCliAuthorization",
  summary: "Start CLI login",
  description: "Starts an anonymous, expiring browser authorization for the Paseo CLI.",
  tags: ["CLI login"],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: StartCliAuthorizationRequestSchema } },
    },
  },
  responses: {
    201: {
      description: "The CLI login request was created.",
      content: { "application/json": { schema: CliAuthorizationSchema } },
    },
    429: { description: "Too many active authorization requests." },
    503: { description: "Durable storage is unavailable." },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/cli-authorizations/poll",
  operationId: "pollCliAuthorization",
  summary: "Poll CLI login",
  description:
    "Polls an anonymous CLI login request. An approved credential is disclosed exactly once.",
  tags: ["CLI login"],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: PollCliAuthorizationRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "The current authorization state.",
      content: { "application/json": { schema: CliAuthorizationPollSchema } },
    },
    503: { description: "Durable storage is unavailable." },
  },
});

const requestIdResponseHeader = {
  "X-Request-ID": {
    description: "The accepted or generated request identifier.",
    schema: { type: "string" as const },
  },
};

for (const definition of publicOperationManifest) {
  const responses = Object.fromEntries(
    Object.entries(definition.responses).map(([status, description]) => [
      status,
      Number(status) === definition.successStatus
        ? {
            description,
            headers: requestIdResponseHeader,
            content: { "application/json": { schema: definition.successSchema } },
          }
        : {
            description,
            headers: {
              ...requestIdResponseHeader,
              ...(Number(status) === 401
                ? {
                    "WWW-Authenticate": {
                      description: "Bearer authentication challenge.",
                      schema: { type: "string" as const, example: "Bearer" },
                    },
                  }
                : {}),
            },
            content: { "application/problem+json": { schema: ProblemSchema } },
          },
    ]),
  );
  registry.registerPath({
    method: definition.method,
    path: definition.path,
    operationId: definition.id,
    summary: definition.summary,
    description: definition.description,
    tags: [definition.tag],
    security: [{ bearerAuth: [] }],
    ...(definition.requestSchema === undefined
      ? {}
      : {
          request: {
            body: {
              required: true,
              content: { "application/json": { schema: definition.requestSchema } },
            },
          },
        }),
    responses,
    "x-required-scopes": [definition.scope],
  });
}

export const publicOpenApiDocument = new OpenApiGeneratorV31(registry.definitions).generateDocument(
  {
    openapi: "3.1.0",
    info: {
      title: "Paseo Hub Public API",
      version: "1.0.0",
      description:
        "Log in the CLI, list projects, validate and install configuration, dispatch manual runs, and enroll Paseo daemons.",
    },
    servers: [{ url: "/", description: "This Hub instance" }],
    tags: [
      { name: "CLI login" },
      { name: "Projects" },
      { name: "Configurations" },
      { name: "Runs" },
      { name: "Daemons" },
    ],
  },
);
