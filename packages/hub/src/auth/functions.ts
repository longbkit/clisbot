import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { isAPIError } from "better-auth/api";
import { z } from "zod";
import { respondOk, type Result } from "../contract/respond.js";
import { reportFailure, respondWithFailure } from "../failures/index.js";
import { getApplication } from "../server/runtime.js";
import {
  accountStateSchema,
  invitationRoleSchema,
  organizationRoleSchema,
} from "./organization-contract.js";
import { PASSWORD_MIN_LENGTH } from "./instance-policy.js";
import { API_KEY_SCOPES, apiKeyScopeSchema } from "./api-key-contract.js";
import { parseEntitlementDenial, type EntitlementDenialPayload } from "../entitlements/denial.js";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(PASSWORD_MIN_LENGTH),
});
const signUpSchema = credentialsSchema.extend({
  name: z.string().trim().min(1),
  invitation: z.string().min(1).optional(),
});
const invitationSchema = z.object({ invitation: z.string().optional() });
const initialOperatorSchema = credentialsSchema.strip();
const createOrganizationSchema = z.object({ name: z.string().trim().min(1).max(100) });
const selectOrganizationSchema = z.object({ organizationId: z.string().min(1) });
const createInvitationSchema = z.object({ email: z.string().email(), role: invitationRoleSchema });
const invitationIdSchema = z.object({ invitationId: z.string().min(1) });
const changeRoleSchema = z.object({ memberId: z.string().min(1), role: organizationRoleSchema });
const memberIdSchema = z.object({ memberId: z.string().min(1) });
const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH),
});
const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(apiKeyScopeSchema).min(1),
});
const apiKeyIdSchema = z.object({ id: z.string().uuid() });
const apiKeySummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(apiKeyScopeSchema),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
const cliCredentialSummarySchema = z.object({
  id: z.string().uuid(),
  prefix: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
const apiKeyCreateResultSchema = z.object({
  key: apiKeySummarySchema,
  secret: z.string().min(1),
});

export const accountState = createServerFn({ method: "GET" })
  .validator(invitationSchema)
  .handler(async ({ data }): Promise<Result<z.infer<typeof accountStateSchema>>> => {
    const request = getRequest();
    const url = new URL("/api/auth/paseo/state", request.url);
    if (data.invitation !== undefined) url.searchParams.set("invitation", data.invitation);
    try {
      const response = await (
        await getApplication()
      ).browserAccount?.(new Request(url, { headers: request.headers }));
      if (response === undefined) {
        return respondWithFailure(
          new Error("browser account capability unavailable"),
          accountContext("auth.account_state"),
          { fallback: "Hub couldn't load your account. Reload the page." },
        );
      }
      if (!response.ok) {
        return accountResponseFailure(
          "auth.account_state",
          response,
          "Hub couldn't load your account. Reload the page.",
        );
      }
      return respondOk(accountStateSchema.parse(await response.json()));
    } catch (error) {
      return respondWithFailure(error, accountContext("auth.account_state"), {
        fallback: "Hub couldn't load your account. Reload the page.",
      });
    }
  });

export const signIn = createServerFn({ method: "POST" })
  .validator(credentialsSchema)
  .handler(async ({ data }): Promise<Result<Record<string, never>>> => {
    try {
      const application = await getApplication();
      if (application.signInEmail === undefined) throw new Error("auth unavailable");
      await application.signInEmail(data, getRequest().headers);
      return respondOk({});
    } catch (error) {
      if (isAPIError(error) && error.body?.code === "INVALID_EMAIL_OR_PASSWORD") {
        return respondWithFailure(
          error,
          accountContext("auth.sign_in"),
          { fallback: "The email or password is incorrect." },
          { kind: "authentication" },
        );
      }
      return respondWithFailure(error, accountContext("auth.sign_in"), {
        fallback:
          "Hub couldn't sign you in. Check that the server is available, then submit the form again.",
      });
    }
  });

export const signUp = createServerFn({ method: "POST" })
  .validator(signUpSchema)
  .handler(async ({ data }): Promise<Result<Record<string, never>>> => {
    try {
      const application = await getApplication();
      if (application.signUpEmail === undefined) throw new Error("auth unavailable");
      await application.signUpEmail(
        { name: data.name, email: data.email, password: data.password },
        getRequest().headers,
        data.invitation,
      );
      return respondOk({});
    } catch (error) {
      return respondWithFailure(error, accountContext("auth.sign_up"), {
        fallback:
          "Hub couldn't create the account. Check the invitation and registration settings, then submit again.",
      });
    }
  });

/**
 * The first-run claim. Answers `unavailable` — never an error — when this instance already
 * belongs to someone, so the public form cannot be used to probe an instance's history.
 */
export const setUpInstance = createServerFn({ method: "POST" })
  .validator(initialOperatorSchema)
  .handler(async ({ data }): Promise<Result<{ state: "claimed" | "unavailable" }>> => {
    try {
      const application = await getApplication();
      if (application.claimInstance === undefined) throw new Error("auth unavailable");
      const claim = await application.claimInstance(data, getRequest().headers);
      return respondOk({ state: claim.status });
    } catch (error) {
      return respondWithFailure(error, accountContext("auth.setup_instance"), {
        fallback:
          "Hub couldn't finish the first account setup. Reload the page to confirm whether this instance has already been claimed.",
      });
    }
  });

export const completeAppSetup = createServerFn({ method: "POST" }).handler(
  async (): Promise<Result<Record<string, never>>> => {
    try {
      const application = await getApplication();
      if (application.completeAppOnboarding === undefined) throw new Error("auth unavailable");
      await application.completeAppOnboarding(getRequest());
      return respondOk({});
    } catch (error) {
      return respondWithFailure(error, accountContext("auth.complete_app_setup"), {
        fallback:
          "Hub couldn't finish app setup. Reload the page to confirm your current setup state.",
      });
    }
  },
);

export const signOut = createServerFn({ method: "POST" }).handler(
  async (): Promise<Result<Record<string, never>>> => {
    try {
      const application = await getApplication();
      if (application.signOut === undefined) throw new Error("auth unavailable");
      await application.signOut(getRequest().headers);
      return respondOk({});
    } catch (error) {
      return respondWithFailure(error, accountContext("auth.sign_out"), {
        fallback:
          "Hub couldn't complete sign out. Close this browser session if you are on a shared device.",
      });
    }
  },
);

export const changePassword = createServerFn({ method: "POST" })
  .validator(passwordChangeSchema)
  .handler(async ({ data }): Promise<Result<Record<string, never>>> => {
    try {
      const application = await getApplication();
      if (application.changePassword === undefined) throw new Error("auth unavailable");
      await application.changePassword(data, getRequest().headers);
      return respondOk({});
    } catch (error) {
      if (isAPIError(error) && error.body?.code === "INVALID_PASSWORD") {
        return respondWithFailure(
          error,
          accountContext("auth.change_password"),
          { fallback: "The current password is incorrect." },
          { kind: "authentication" },
        );
      }
      return respondWithFailure(error, accountContext("auth.change_password"), {
        fallback: "Hub couldn't change your password. Your existing password is still active.",
      });
    }
  });

export const listApiKeys = createServerFn({ method: "GET" }).handler(
  async (): Promise<
    Result<{
      keys: z.infer<typeof apiKeySummarySchema>[];
      cliCredentials: z.infer<typeof cliCredentialSummarySchema>[];
    }>
  > => {
    const response = await sendAccountQuery("/api/auth/paseo/api-keys");
    if (response instanceof AccountRequestError)
      return accountTransportFailure(
        response,
        "auth.api_keys.list",
        "Hub couldn't load API keys. Reload the page.",
      );
    if (!response.ok)
      return accountResponseFailure(
        "auth.api_keys.list",
        response,
        "Hub couldn't load API keys. Reload the page.",
      );
    try {
      return respondOk(
        z
          .object({
            keys: z.array(apiKeySummarySchema),
            cliCredentials: z.array(cliCredentialSummarySchema),
          })
          .parse(await response.json()),
      );
    } catch (error) {
      return respondWithFailure(error, accountContext("auth.api_keys.list_response"), {
        fallback: "Hub received an invalid API-key response. Reload the page.",
      });
    }
  },
);

export const createApiKey = createServerFn({ method: "POST" })
  .validator(apiKeyCreateSchema)
  .handler(async ({ data }): Promise<Result<z.infer<typeof apiKeyCreateResultSchema>>> => {
    const response = await sendAccountCommand("/api/auth/paseo/api-keys", data);
    if (response instanceof AccountRequestError)
      return accountTransportFailure(
        response,
        "auth.api_keys.create",
        "Hub couldn't create the API key. No key was issued.",
      );
    if (!response.ok)
      return accountResponseFailure(
        "auth.api_keys.create",
        response,
        "Hub couldn't create the API key. No key was issued.",
      );
    try {
      const result = apiKeyCreateResultSchema.parse(await response.json());
      return respondOk(result);
    } catch (error) {
      return respondWithFailure(error, accountContext("auth.api_keys.create_response"), {
        fallback:
          "Hub couldn't read the new API key. Revoke the key from this page if it appears in the list.",
      });
    }
  });

export const revokeApiKey = createServerFn({ method: "POST" })
  .validator(apiKeyIdSchema)
  .handler(async ({ data }): Promise<Result<Record<string, never>>> => {
    const response = await sendAccountCommand("/api/auth/paseo/revoke-api-key", data);
    if (response instanceof AccountRequestError || !response.ok) {
      return response instanceof AccountRequestError
        ? accountTransportFailure(
            response,
            "auth.api_keys.revoke",
            "Hub couldn't revoke the API key. Reload the list to confirm its status.",
          )
        : accountResponseFailure(
            "auth.api_keys.revoke",
            response,
            "Hub couldn't revoke the API key. Reload the list to confirm its status.",
          );
    }
    return respondOk({});
  });

export const revokeCliCredential = createServerFn({ method: "POST" })
  .validator(apiKeyIdSchema)
  .handler(async ({ data }): Promise<Result<Record<string, never>>> => {
    const response = await sendAccountCommand("/api/auth/paseo/revoke-cli-credential", data);
    if (response instanceof AccountRequestError || !response.ok) {
      return response instanceof AccountRequestError
        ? accountTransportFailure(
            response,
            "auth.cli_credentials.revoke",
            "Hub couldn't revoke the CLI login. Reload the list to confirm its status.",
          )
        : accountResponseFailure(
            "auth.cli_credentials.revoke",
            response,
            "Hub couldn't revoke the CLI login. Reload the list to confirm its status.",
          );
    }
    return respondOk({});
  });

type AccountCommandResult = Result<{
  state: "sessionExpired" | "organizationRequired" | "complete";
}>;

type CreateOrganizationCommandResult = Result<{
  state: "sessionExpired" | "complete";
  organizationSlug?: string;
}>;

export const createOrganization = createServerFn({ method: "POST" })
  .validator(createOrganizationSchema)
  .handler(async ({ data }): Promise<CreateOrganizationCommandResult> => {
    const response = await sendAccountCommand("/api/auth/paseo/create-organization", data);
    if (response instanceof AccountRequestError) {
      return accountTransportFailure(
        response,
        "auth.organization.create",
        "Hub couldn't create the organization. Reload the organization list before submitting again.",
      );
    }
    if (response.status === 401)
      return accountStateFailure("auth.organization.create", response, "sessionExpired");
    if (!response.ok)
      return accountResponseFailure(
        "auth.organization.create",
        response,
        "Hub couldn't create the organization. Review its name and your permissions before submitting again.",
      );
    try {
      const result = z.object({ organizationSlug: z.string().min(1) }).parse(await response.json());
      return respondOk({ state: "complete", organizationSlug: result.organizationSlug });
    } catch (error) {
      return respondWithFailure(error, accountContext("auth.organization.create_response"), {
        fallback: "Hub created the organization but couldn't open it. Reload the page to continue.",
      });
    }
  });

export const selectOrganization = createServerFn({ method: "POST" })
  .validator(selectOrganizationSchema)
  .handler(async ({ data }): Promise<AccountCommandResult> => {
    const response = await sendAccountCommand("/api/auth/paseo/select-organization", data);
    if (response instanceof AccountRequestError) {
      return accountTransportFailure(
        response,
        "auth.organization.select",
        "Hub couldn't switch organizations. Reload the page to refresh your available organizations.",
      );
    }
    if (response.status === 401)
      return accountStateFailure("auth.organization.select", response, "sessionExpired");
    if (!response.ok)
      return accountResponseFailure(
        "auth.organization.select",
        response,
        "Hub couldn't switch organizations. Reload the page to refresh your available organizations.",
      );
    return respondOk({ state: "complete" });
  });

export const createInvitation = createServerFn({ method: "POST" })
  .validator(createInvitationSchema)
  .handler(async ({ data }): Promise<AccountCommandResult> => {
    const response = await sendAccountCommand("/api/auth/paseo/create-invitation", data);
    if (response instanceof AccountRequestError) {
      return accountTransportFailure(
        response,
        "auth.invitation.create",
        "Hub couldn't create the invitation. Check the address, role, and organization limits before submitting again.",
      );
    }
    if (response.status === 401)
      return accountStateFailure("auth.invitation.create", response, "sessionExpired");
    if (response.status === 403)
      return accountStateFailure("auth.invitation.create", response, "organizationRequired");
    if (response.status === 409) {
      const denial = parseEntitlementDenial(await response.json().catch(() => undefined));
      if (denial !== undefined) {
        return respondWithFailure(
          new Error("invitation entitlement denied"),
          accountContext("auth.invitation.create"),
          { fallback: invitationDenialMessage(denial) },
          { kind: "conflict" },
        );
      }
    }
    if (!response.ok)
      return accountResponseFailure(
        "auth.invitation.create",
        response,
        "Hub couldn't create the invitation. Check the address, role, and organization limits before submitting again.",
      );
    return respondOk({ state: "complete" });
  });

function invitationDenialMessage(denial: EntitlementDenialPayload): string {
  // Neutral on remedy: raising a limit is the instance operator's job, not the org owner's, and
  // this renders on self-hosted too where there is nothing to upgrade. The Usage page shows the
  // limit and current use; who can change it depends on the deployment.
  if (denial.entitlement === "canInviteMembers") {
    return "Inviting members isn't enabled for this organization. See the Usage page for its limits.";
  }
  return `Seat limit reached — ${denial.current} of ${denial.limit} seats are in use. See the Usage page for this organization's limits.`;
}

export const cancelInvitation = createServerFn({ method: "POST" })
  .validator(invitationIdSchema)
  .handler(async ({ data }): Promise<AccountCommandResult> => {
    const response = await sendAccountCommand("/api/auth/paseo/cancel-invitation", data);
    if (response instanceof AccountRequestError) {
      return accountTransportFailure(
        response,
        "auth.invitation.cancel",
        "Hub couldn't cancel the invitation. Reload the invitation list to confirm its status.",
      );
    }
    if (response.status === 401)
      return accountStateFailure("auth.invitation.cancel", response, "sessionExpired");
    if (response.status === 403)
      return accountStateFailure("auth.invitation.cancel", response, "organizationRequired");
    if (!response.ok)
      return accountResponseFailure(
        "auth.invitation.cancel",
        response,
        "Hub couldn't cancel the invitation. Reload the invitation list to confirm its status.",
      );
    return respondOk({ state: "complete" });
  });

export const acceptInvitation = createServerFn({ method: "POST" })
  .validator(invitationIdSchema)
  .handler(async ({ data }): Promise<AccountCommandResult> => {
    const response = await sendAccountCommand("/api/auth/paseo/accept-invitation", data);
    if (response instanceof AccountRequestError)
      return accountTransportFailure(
        response,
        "auth.invitation.accept",
        "This invitation is unavailable or has expired.",
      );
    if (response.status === 401)
      return accountStateFailure("auth.invitation.accept", response, "sessionExpired");
    if (!response.ok)
      return accountResponseFailure(
        "auth.invitation.accept",
        response,
        "This invitation is unavailable or has expired.",
      );
    return respondOk({ state: "complete" });
  });

export const changeMemberRole = createServerFn({ method: "POST" })
  .validator(changeRoleSchema)
  .handler(async ({ data }): Promise<AccountCommandResult> => {
    const response = await sendAccountCommand("/api/auth/paseo/change-member-role", data);
    if (response instanceof AccountRequestError)
      return accountTransportFailure(
        response,
        "auth.team.change_role",
        "Hub couldn't change the member's role. Reload the team list to confirm its current role.",
      );
    if (response.status === 401)
      return accountStateFailure("auth.team.change_role", response, "sessionExpired");
    if (response.status === 403)
      return accountStateFailure("auth.team.change_role", response, "organizationRequired");
    if (!response.ok)
      return accountResponseFailure(
        "auth.team.change_role",
        response,
        "Hub couldn't change the member's role. Check your permissions and reload the team list.",
      );
    return respondOk({ state: "complete" });
  });

export const removeMember = createServerFn({ method: "POST" })
  .validator(memberIdSchema)
  .handler(async ({ data }): Promise<AccountCommandResult> => {
    const response = await sendAccountCommand("/api/auth/paseo/remove-member", data);
    if (response instanceof AccountRequestError)
      return accountTransportFailure(
        response,
        "auth.team.remove_member",
        "Hub couldn't remove the member. Reload the team list to confirm membership.",
      );
    if (response.status === 401)
      return accountStateFailure("auth.team.remove_member", response, "sessionExpired");
    if (response.status === 403)
      return accountStateFailure("auth.team.remove_member", response, "organizationRequired");
    if (!response.ok)
      return accountResponseFailure(
        "auth.team.remove_member",
        response,
        "Hub couldn't remove the member. Check your permissions and reload the team list.",
      );
    return respondOk({ state: "complete" });
  });

async function sendAccountCommand(
  path: string,
  data: unknown,
): Promise<Response | AccountRequestError> {
  const incoming = getRequest();
  try {
    const headers = new Headers(incoming.headers);
    headers.delete("content-length");
    headers.set("content-type", "application/json");
    const response = await (
      await getApplication()
    ).browserAccount?.(
      new Request(new URL(path, incoming.url), {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      }),
    );
    return response ?? new AccountRequestError(new Error("browser account capability unavailable"));
  } catch (error) {
    return new AccountRequestError(error);
  }
}

async function sendAccountQuery(path: string): Promise<Response | AccountRequestError> {
  const incoming = getRequest();
  try {
    const response = await (
      await getApplication()
    ).browserAccount?.(new Request(new URL(path, incoming.url), { headers: incoming.headers }));
    return response ?? new AccountRequestError(new Error("browser account capability unavailable"));
  } catch (error) {
    return new AccountRequestError(error);
  }
}

function accountContext(operation: string) {
  return { operation, component: "auth" } as const;
}

class AccountRequestError extends Error {
  constructor(cause: unknown) {
    super("account request failed", { cause });
    this.name = "AccountRequestError";
  }
}

function accountTransportFailure(error: AccountRequestError, operation: string, message: string) {
  return respondWithFailure(error, accountContext(operation), { fallback: message });
}

function accountResponseFailure(operation: string, response: Response, message: string) {
  return respondWithFailure(
    new Error(`account operation returned HTTP ${response.status}`),
    { ...accountContext(operation), status: response.status },
    {
      fallback: message,
      authentication: message,
      forbidden: message,
      notFound: message,
      conflict: message,
      validation: message,
    },
    { status: response.status },
  );
}

function accountStateFailure<TState extends "sessionExpired" | "organizationRequired">(
  operation: string,
  response: Response,
  state: TState,
): Result<{ state: TState }> {
  reportFailure(
    new Error(`account operation returned HTTP ${response.status}`),
    { ...accountContext(operation), status: response.status },
    { status: response.status, kind: state === "sessionExpired" ? "authentication" : "forbidden" },
  );
  return respondOk({ state });
}

export { API_KEY_SCOPES };
