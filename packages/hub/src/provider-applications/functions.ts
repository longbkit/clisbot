import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { respondOk, type Result } from "../contract/respond.js";
import { respondWithFailure } from "../failures/index.js";
import { getApplication } from "../server/runtime.js";
import {
  type ProviderApplicationConfiguration,
  type ProviderApplicationOverview,
  type ProviderApplicationSaveResult,
} from "./index.js";
import { providerApplicationSaveFailure, providerHost, providerName } from "./save-failure.js";

const providerSchema = z.enum(["github", "slack", "discord", "linear"]);
const surfaceSchema = z.enum(["appSetup", "apps"]).optional();
const expectedVersionSchema = z.number().int().positive().optional();
const configurationSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("github"),
    appId: z.string().trim().min(1),
    appSlug: z.string().trim().min(1),
    clientId: z.string().trim().min(1),
    clientSecret: z.string().min(1),
    privateKey: z.string().min(1),
    // Optional: event triggers need a public HTTPS address, repository access does not.
    webhookSecret: z.string().min(1).optional(),
    expectedVersion: expectedVersionSchema,
    surface: surfaceSchema,
  }),
  z.object({
    provider: z.literal("slack"),
    transport: z.literal("webhook"),
    appId: z.string().trim().min(1),
    clientId: z.string().trim().min(1),
    clientSecret: z.string().min(1),
    signingSecret: z.string().min(1),
    expectedVersion: expectedVersionSchema,
    surface: surfaceSchema,
  }),
  z.object({
    provider: z.literal("discord"),
    applicationId: z.string().trim().min(1),
    clientSecret: z.string().min(1),
    botToken: z.string().min(1),
    expectedVersion: expectedVersionSchema,
    surface: surfaceSchema,
  }),
  z.object({
    provider: z.literal("linear"),
    clientId: z.string().trim().min(1),
    clientSecret: z.string().min(1),
    webhookSecret: z.string().min(1),
    expectedVersion: expectedVersionSchema,
    surface: surfaceSchema,
  }),
]);
const connectionSchema = z.object({
  provider: providerSchema,
  organizationId: z.string().min(1),
  surface: surfaceSchema,
});
const slackSocketSchema = z.object({
  appToken: z.string().trim().startsWith("xapp-").min(6),
  botToken: z.string().trim().startsWith("xoxb-").min(6),
  expectedVersion: expectedVersionSchema,
});

export const providerApplicationsOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<Result<ProviderApplicationOverview>> => {
    try {
      const capability = (await getApplication()).providerApplications;
      if (capability === null) throw new Error("unavailable");
      return respondOk(await capability.overview(getRequest()));
    } catch (error) {
      return respondWithFailure(
        error,
        { operation: "provider_application.overview", component: "provider_applications" },
        {
          fallback: "Hub couldn't load your apps. Reload the page.",
          forbidden: "Only an instance operator can view app setup.",
          authentication: "Your session has expired. Sign in again to view app setup.",
          network: "Hub couldn't reach its own data to read your apps. Reload the page.",
          timeout: "Reading your apps took too long. Reload the page.",
        },
      );
    }
  },
);

export const verifyAndSaveProviderApplication = createServerFn({ method: "POST" })
  .validator(configurationSchema)
  .handler(async ({ data }): Promise<Result<ProviderApplicationSaveResult>> => {
    try {
      const capability = (await getApplication()).providerApplications;
      if (capability === null) throw new Error("unavailable");
      return respondOk(
        await capability.verifyAndSave(
          getRequest(),
          data.provider,
          normalizedConfiguration(data),
          data.surface,
        ),
      );
    } catch (error) {
      return providerApplicationSaveFailure(
        data.provider,
        error,
        sensitiveConfigurationValues(data),
      );
    }
  });

export const beginProviderConnection = createServerFn({ method: "POST" })
  .validator(connectionSchema)
  .handler(async ({ data }): Promise<Result<{ url: string }>> => {
    try {
      const capability = (await getApplication()).providerApplications;
      if (capability === null) throw new Error("unavailable");
      return respondOk(
        await capability.beginConnection(
          getRequest(),
          data.provider,
          data.organizationId,
          data.surface,
        ),
      );
    } catch (error) {
      const name = providerName(data.provider);
      return respondWithFailure(
        error,
        {
          operation: "provider_application.begin_connection",
          component: "provider_applications",
          provider: data.provider,
        },
        {
          fallback: `Something went wrong while starting the ${name} connection. Nothing was connected. Try again.`,
          forbidden: `You don't have permission to connect ${name} to this organization.`,
          authentication: `Your session has expired. Nothing was connected. Sign in again, then start the connection again.`,
          notFound: `There are no saved ${name} credentials to connect. Verify and save the app first.`,
          validation: `Hub couldn't confirm the address this page was opened at, so the connection was refused. Nothing was connected. Open Hub at its usual address, then start again.`,
          conflict: `The ${name} app changed while this connection was starting. Nothing was connected. Reload the page, then start again.`,
          network: `Hub couldn't reach ${name}. Nothing was connected. Check this server's network, DNS, and TLS access to ${providerHost(data.provider)}, then start again.`,
          timeout: `${name} didn't answer in time. Nothing was connected. Try again.`,
          rateLimited: `${name} is rate limiting Hub. Nothing was connected. Wait a few minutes, then start again.`,
          upstreamUnavailable: `${name} returned an error of its own. Nothing was connected. Check ${name}'s status page, then start again.`,
        },
      );
    }
  });

export const configureSlackSocketApplication = createServerFn({ method: "POST" })
  .validator(slackSocketSchema)
  .handler(async ({ data }): Promise<Result<ProviderApplicationSaveResult>> => {
    try {
      const capability = (await getApplication()).providerApplications;
      if (capability === null) throw new Error("unavailable");
      return respondOk(
        await capability.configureSlackSocket(getRequest(), {
          appToken: data.appToken,
          botToken: data.botToken,
          ...(data.expectedVersion === undefined ? {} : { expectedVersion: data.expectedVersion }),
        }),
      );
    } catch (error) {
      return providerApplicationSaveFailure("slack", error, [data.appToken, data.botToken]);
    }
  });

export const retrySlackSocketDelivery = createServerFn({ method: "POST" }).handler(
  async (): Promise<Result<void>> => {
    try {
      const capability = (await getApplication()).providerApplications;
      if (capability === null) throw new Error("unavailable");
      await capability.retrySlackSocket(getRequest());
      return respondOk(undefined);
    } catch (error) {
      return respondWithFailure(
        error,
        { operation: "slack.socket.retry", component: "provider_applications", provider: "slack" },
        {
          fallback: "Hub couldn't retry Slack. Sign in as the instance operator, then try again.",
        },
      );
    }
  },
);

function sensitiveConfigurationValues(
  configuration: z.infer<typeof configurationSchema>,
): readonly string[] {
  if (configuration.provider === "github") {
    return [
      configuration.clientSecret,
      configuration.privateKey,
      ...(configuration.webhookSecret === undefined ? [] : [configuration.webhookSecret]),
    ];
  }
  if (configuration.provider === "slack") {
    return [configuration.clientSecret, configuration.signingSecret];
  }
  if (configuration.provider === "linear") {
    return [configuration.clientSecret, configuration.webhookSecret];
  }
  return [configuration.clientSecret, configuration.botToken];
}

function normalizedConfiguration(
  data: z.infer<typeof configurationSchema>,
): ProviderApplicationConfiguration {
  const version =
    data.expectedVersion === undefined ? {} : { expectedVersion: data.expectedVersion };
  if (data.provider === "github") {
    return {
      provider: data.provider,
      appId: data.appId,
      appSlug: data.appSlug,
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      privateKey: data.privateKey,
      ...(data.webhookSecret === undefined ? {} : { webhookSecret: data.webhookSecret }),
      ...version,
    };
  }
  if (data.provider === "slack") {
    return {
      provider: data.provider,
      transport: data.transport,
      appId: data.appId,
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      signingSecret: data.signingSecret,
      ...version,
    };
  }
  if (data.provider === "linear") {
    return {
      provider: data.provider,
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      webhookSecret: data.webhookSecret,
      ...version,
    };
  }
  return {
    provider: data.provider,
    applicationId: data.applicationId,
    clientSecret: data.clientSecret,
    botToken: data.botToken,
    ...version,
  };
}
