import { AsyncLocalStorage } from "node:async_hooks";
import { createAuthMiddleware } from "better-auth/api";
import { APIError, serializeSignedCookie } from "better-call";
import type { BetterAuthPlugin } from "better-auth";
import type { AccountSession } from "./organization-access.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import { z } from "zod";

/** Translate verified OAuth identity; Better Auth still owns validation and mutations. */
export function oauthProductSession(database: DatabaseRuntime) {
  const scope = new AsyncLocalStorage<AccountSession>();
  const plugin = {
    id: "clisbot-oauth-product-session",
    hooks: {
      before: [
        {
          matcher: () => scope.getStore() !== undefined,
          handler: createAuthMiddleware(async (ctx) => {
            const account = scope.getStore();
            if (!account) return undefined;
            const user = await ctx.context.internalAdapter.findUserById(account.userId);
            if (!user) throw new APIError("UNAUTHORIZED");
            // Sensitive endpoints additionally require a live authoritative session.
            if (ctx.path === "/change-password") {
              const result = await database.query<{ token: string }>(
                `select token from session where id = $1 and user_id = $2 and expires_at > now()`,
                [account.sessionId, account.userId],
              );
              const token = result.rows[0]?.token;
              if (!token) throw new APIError("UNAUTHORIZED");
              const cookie = await serializeSignedCookie(
                ctx.context.authCookies.sessionToken.name,
                token,
                ctx.context.secret,
              );
              const headers = new Headers(ctx.headers);
              headers.set("cookie", cookie.split(";")[0]!);
              return { context: { headers } };
            }
            return {
              context: {
                context: {
                  session: {
                    user,
                    session: {
                      id: account.sessionId,
                      userId: account.userId,
                      token: "",
                      activeOrganizationId: account.activeOrganizationId,
                      activeTeamId: null,
                      createdAt: new Date(),
                      updatedAt: new Date(),
                      expiresAt: new Date(Date.now() + 300_000),
                    },
                  },
                },
              },
            };
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
  return {
    plugin,
    async handle(
      request: Request,
      account: AccountSession,
      handler: (request: Request) => Promise<Response>,
    ): Promise<Response> {
      const url = new URL(request.url);
      const body: unknown =
        request.method === "GET"
          ? undefined
          : await request
              .clone()
              .json()
              .catch(() => undefined);
      const params = z.record(z.string(), z.unknown()).safeParse(body);
      const fields = params.success ? params.data : {};
      const data = z.record(z.string(), z.unknown()).safeParse(fields["data"]);
      const organizationIds = [
        url.searchParams.get("organizationId"),
        fields["organizationId"],
        data.success ? data.data["organizationId"] : undefined,
      ];
      if (
        organizationIds.some(
          (id) => id !== undefined && id !== null && id !== account.activeOrganizationId,
        )
      )
        return Response.json({ error: "forbidden" }, { status: 403 });
      // Check query and body independently: an ignored query parameter cannot mask a body ID.
      for (const teamId of [url.searchParams.get("teamId"), fields["teamId"]]) {
        if (teamId === undefined || teamId === null) continue;
        if (typeof teamId !== "string")
          return Response.json({ error: "invalid_request" }, { status: 400 });
        const team = await database.query<{ organization_id: string }>(
          `select organization_id from team where id = $1`,
          [teamId],
        );
        if (team.rows[0]?.organization_id !== account.activeOrganizationId)
          return Response.json({ error: "forbidden" }, { status: 403 });
      }
      const headers = new Headers(request.headers);
      for (const name of ["cookie", "origin", "referer", "sec-fetch-site"]) headers.delete(name);
      const response = await scope.run(account, () => handler(new Request(request, { headers })));
      // Neither native nor browser callers may acquire a browser session credential.
      response.headers.delete("set-cookie");
      if (response.ok && url.pathname === "/api/auth/change-password") {
        const value = z.record(z.string(), z.unknown()).parse(await response.json());
        return Response.json(
          { ...value, token: null },
          { status: response.status, headers: response.headers },
        );
      }
      if (response.ok && url.pathname === "/api/auth/organization/list-user-teams") {
        const teams = z
          .array(z.object({ organizationId: z.string() }).passthrough())
          .parse(await response.json());
        return Response.json(
          teams.filter((team) => team.organizationId === account.activeOrganizationId),
          { headers: response.headers },
        );
      }
      return response;
    },
  };
}
