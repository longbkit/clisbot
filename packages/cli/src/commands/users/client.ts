// COMPAT(clisbot-control-plane): thin HTTP layer for the `users` verbs — the
// running Hub's user records (implementation doc §1.4, §3.2, §4-S4).

import { z } from "zod";
import { controlPlaneRequest, type ControlPlaneTarget } from "../control-plane.js";
import { requestHub } from "../hub/hub-client/internal/transport.js";

const userSchema = z
  .object({
    username: z.string(),
    name: z.string().nullable(),
    identities: z.array(z.string()),
    roles: z.array(z.string()),
  })
  .strict();

const userListResponseSchema = z.object({ users: z.array(userSchema) }).strict();

const userEditResultSchema = z.object({ username: z.string(), deployed: z.boolean() }).strict();

export type User = z.infer<typeof userSchema>;
export type UserEditResult = z.infer<typeof userEditResultSchema>;

export interface UserAddInput {
  username: string;
  name?: string;
  identities: string[];
}

export interface UserEditInput {
  name?: string;
  identities?: string[];
}

/** GET /api/v1/users — every user record. */
export function listUsers(target: ControlPlaneTarget): Promise<User[]> {
  return controlPlaneRequest(async () => {
    const response = await requestHub({
      origin: target.origin,
      ...(target.apiKey === undefined ? {} : { apiKey: target.apiKey }),
      path: "/api/v1/users",
      method: "GET",
      successStatus: 200,
      schema: userListResponseSchema,
      failureMessage: "Hub user listing failed",
    });
    return response.users;
  });
}

/** GET /api/v1/users/<username> — a single user record. */
export function showUser(target: ControlPlaneTarget, username: string): Promise<User> {
  return controlPlaneRequest(() =>
    requestHub({
      origin: target.origin,
      ...(target.apiKey === undefined ? {} : { apiKey: target.apiKey }),
      path: `/api/v1/users/${encodeURIComponent(username)}`,
      method: "GET",
      successStatus: 200,
      schema: userSchema,
      failureMessage: "Hub user lookup failed",
    }),
  );
}

/** POST /api/v1/users — create a user record. */
export function addUser(target: ControlPlaneTarget, input: UserAddInput): Promise<UserEditResult> {
  return controlPlaneRequest(() =>
    requestHub({
      origin: target.origin,
      ...(target.apiKey === undefined ? {} : { apiKey: target.apiKey }),
      path: "/api/v1/users",
      method: "POST",
      body: {
        username: input.username,
        ...(input.name === undefined ? {} : { name: input.name }),
        identities: input.identities,
      },
      successStatus: 200,
      schema: userEditResultSchema,
      failureMessage: "Hub user add failed",
    }),
  );
}

/** PUT /api/v1/users/<username> — update a user record's name and/or identities. */
export function editUser(
  target: ControlPlaneTarget,
  username: string,
  input: UserEditInput,
): Promise<UserEditResult> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.identities !== undefined) body.identities = input.identities;
  return controlPlaneRequest(() =>
    requestHub({
      origin: target.origin,
      ...(target.apiKey === undefined ? {} : { apiKey: target.apiKey }),
      path: `/api/v1/users/${encodeURIComponent(username)}`,
      method: "PUT",
      body,
      successStatus: 200,
      schema: userEditResultSchema,
      failureMessage: "Hub user edit failed",
    }),
  );
}
