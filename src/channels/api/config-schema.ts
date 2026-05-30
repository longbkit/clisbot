import { z } from "zod";
import { defineChannelSchemaContract } from "../../config/channels/channel-schema-contract.ts";
import {
  asChannelProviderConfigSchema,
  createBaseBotSchema,
  createBaseDefaults,
  createBaseDefaultsSchema,
  createGroupDefault,
} from "../config/config-schema-base.ts";

const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

type JsonTemplateValue =
  | string
  | number
  | boolean
  | null
  | JsonTemplateValue[]
  | { [key: string]: JsonTemplateValue };

const mapValueSchema: z.ZodType<JsonTemplateValue> = z.lazy(() =>
  z.union([
    jsonPrimitiveSchema,
    z.array(mapValueSchema),
    z.object({
      from: z.string().min(1),
      map: z.record(z.string(), mapValueSchema),
    }),
    z.record(z.string(), mapValueSchema),
  ])
);

const filterSchema: z.ZodType<any> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(filterSchema).min(1) }),
    z.object({ any: z.array(filterSchema).min(1) }),
    z.object({ not: filterSchema }),
    z.object({
      path: z.string().min(1),
      equals: z.unknown().optional(),
      notEquals: z.unknown().optional(),
      exists: z.boolean().optional(),
      in: z.array(z.unknown()).optional(),
      anyIn: z.array(z.unknown()).optional(),
    }),
  ])
);

const hmacAuthSchema = z.object({
  mode: z.literal("hmac"),
  secretEnv: z.string().min(1),
  timestampHeader: z.string().min(1).optional(),
  signatureHeader: z.string().min(1),
  signaturePrefix: z.string().default("sha256="),
  signingBase: z.string().default("{{timestamp}}.{{rawBody}}"),
  toleranceSecondsEnv: z.string().min(1).optional(),
  toleranceSecondsDefault: z.number().int().positive().default(300),
});

const bearerAuthSchema = z.object({
  mode: z.literal("bearer"),
  tokenEnv: z.string().min(1),
  header: z.string().min(1).default("authorization"),
  scheme: z.string().min(1).default("Bearer"),
});

const noneAuthSchema = z.object({
  mode: z.literal("none"),
});

const ingressSchema = z.object({
  successStatusCode: z.union([z.literal(200), z.literal(202)]).default(202),
  auth: z.discriminatedUnion("mode", [
    hmacAuthSchema,
    bearerAuthSchema,
    noneAuthSchema,
  ]),
  filter: filterSchema.optional(),
  map: z.record(z.string(), mapValueSchema).default({}),
});

const actionSchema = z.object({
  method: z.enum(["POST", "PUT", "PATCH"]).default("POST"),
  url: z.string().min(1),
  headers: z.record(z.string(), mapValueSchema).default({}),
  body: mapValueSchema.optional(),
  rendering: z.object({
    native: z.enum(["text", "markdown"]).default("markdown"),
  }).default({
    native: "markdown",
  }),
  retry: z.object({
    mode: z.literal("none").default("none"),
  }).default({
    mode: "none",
  }),
});

const apiChannelSchemaContract = defineChannelSchemaContract({
  channel: "api",
  configBotKey: "api",
  createSchema: (params) => {
    const botSchema = z.object({
      ...createBaseBotSchema(params),
      ingress: ingressSchema,
      actions: z.object({
        "message.send": actionSchema.optional(),
      }).default({}),
      groups: z.record(z.string(), params.botRouteSchema).default({}),
    });
    const defaults = createBaseDefaults("listener", {
      dmPolicy: "allowlist",
      groupPolicy: "allowlist",
      directMessages: {},
      groups: createGroupDefault(),
      listener: {
        host: "127.0.0.1",
        port: 8787,
      },
    });
    const defaultsSchema = z.object({
      ...createBaseDefaultsSchema(params, z.literal("listener").default("listener")),
      dmPolicy: params.dmPolicySchema.default("allowlist"),
      groupPolicy: params.conversationPolicySchema.default("allowlist"),
      directMessages: z.record(z.string(), params.botRouteSchema).default({}),
      groups: z.record(z.string(), params.botRouteSchema).default({}),
      listener: z.object({
        host: z.string().min(1).default("127.0.0.1"),
        port: z.number().int().min(0).max(65535).default(8787),
      }).default({
        host: "127.0.0.1",
        port: 8787,
      }),
    });
    return asChannelProviderConfigSchema(
      z.object({
        defaults: defaultsSchema.default(defaults as any),
      }).catchall(botSchema).default({ defaults } as any),
    );
  },
});

export default apiChannelSchemaContract;
