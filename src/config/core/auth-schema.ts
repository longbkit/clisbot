import { z } from "zod";
import {
  APP_ADMIN_PERMISSIONS,
  DEFAULT_AGENT_ADMIN_PERMISSIONS,
  DEFAULT_AGENT_MEMBER_PERMISSIONS,
} from "../../auth/defaults.ts";

export const authRoleSchema = z.object({
  allow: z.array(z.string().min(1)).default([]),
  users: z.array(z.string().min(1)).default([]),
});

export const authRoleOverrideSchema = z.object({
  allow: z.array(z.string().min(1)).optional(),
  users: z.array(z.string().min(1)).optional(),
});

export const defaultAppAuthConfig = {
  ownerClaimWindowMinutes: 30,
  defaultRole: "member",
  roles: {
    owner: {
      allow: [...APP_ADMIN_PERMISSIONS],
      users: [],
    },
    admin: {
      allow: [...APP_ADMIN_PERMISSIONS],
      users: [],
    },
    member: {
      allow: [],
      users: [],
    },
  },
};

export const appAuthSchema = z.object({
  ownerClaimWindowMinutes: z.number().int().positive().default(30),
  defaultRole: z.string().min(1).default("member"),
  roles: z.record(z.string(), authRoleSchema).default(defaultAppAuthConfig.roles),
});

export const defaultAgentAuthConfig = {
  defaultRole: "member",
  roles: {
    admin: {
      allow: [...DEFAULT_AGENT_ADMIN_PERMISSIONS],
      users: [],
    },
    member: {
      allow: [...DEFAULT_AGENT_MEMBER_PERMISSIONS],
      users: [],
    },
  },
};

export const agentAuthSchema = z.object({
  defaultRole: z.string().min(1).default("member"),
  roles: z.record(z.string(), authRoleSchema).default(defaultAgentAuthConfig.roles),
});

export const agentAuthOverrideSchema = z.object({
  defaultRole: z.string().min(1).optional(),
  roles: z.record(z.string(), authRoleOverrideSchema).default({}),
});
