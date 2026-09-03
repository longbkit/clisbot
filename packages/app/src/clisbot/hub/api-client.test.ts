import { expect, it } from "vitest";
import { z } from "zod";
import { HubApiClient } from "./api-client";
import type { HubRequestInput, HubTransport } from "./transport/contract";

it("keeps organization management and account-auth resources on their canonical paths", async () => {
  const requests: Array<{ path: string; input: HubRequestInput }> = [];
  const transport: HubTransport = {
    signInKind: "password",
    async request(path, input = {}) {
      requests.push({ path, input });
      return Response.json({ ok: true });
    },
    signIn: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
  };
  const api = new HubApiClient(transport, "organization/one");
  const response = z.object({ ok: z.literal(true) });

  await api.get("daemons", response);
  await api.getAuth("api-keys", response);
  await api.postAuth("revoke-api-key", { id: "key-1" }, response);

  expect(requests).toEqual([
    {
      path: "/api/management/v1/organizations/organization%2Fone/daemons",
      input: {},
    },
    { path: "/api/auth/paseo/api-keys", input: {} },
    {
      path: "/api/auth/paseo/revoke-api-key",
      input: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "key-1" }),
      },
    },
  ]);
});
