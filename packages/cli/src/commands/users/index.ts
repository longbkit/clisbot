// COMPAT(clisbot-control-plane): `users` group — thin verbs over the running
// Hub's user records (implementation doc §1.4, §3.2, §4-S4).

import { Command } from "commander";
import type {
  CommandOptions,
  CommandError,
  ListResult,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import { withOutput } from "../../output/index.js";
import { addJsonOption } from "../../utils/command-options.js";
import {
  addControlPlaneTargetOptions,
  extractControlPlaneOptions,
  requiredStringOption,
  resolveControlPlaneTarget,
  stringOption,
} from "../control-plane.js";
import {
  addUser,
  editUser,
  listUsers,
  showUser,
  type User,
  type UserEditResult,
} from "./client.js";

const usersListSchema: OutputSchema<User> = {
  idField: "username",
  columns: [
    { header: "USERNAME", field: "username" },
    { header: "NAME", field: (item) => item.name ?? "-" },
    { header: "IDENTITIES", field: (item) => item.identities.join(", ") },
    { header: "ROLES", field: (item) => item.roles.join(", ") },
  ],
};

const usersShowSchema: OutputSchema<User> = {
  idField: "username",
  columns: [
    { header: "USERNAME", field: "username" },
    { header: "NAME", field: (item) => item.name ?? "-" },
    { header: "IDENTITIES", field: (item) => item.identities.join(", ") },
    { header: "ROLES", field: (item) => item.roles.join(", ") },
  ],
};

const usersEditSchema: OutputSchema<UserEditResult> = {
  idField: "username",
  columns: [
    { header: "USERNAME", field: "username" },
    {
      header: "DEPLOYED",
      field: "deployed",
      color: (value) => (value === true ? "green" : "yellow"),
    },
  ],
};

/** Split a comma-separated option into non-blank entries. */
function splitCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Required `--identities` as a non-empty list. */
function parseRequiredIdentities(options: CommandOptions): string[] {
  const raw = requiredStringOption(options, "identities");
  const identities = splitCsv(raw);
  if (identities.length === 0) {
    const error: CommandError = {
      code: "INVALID_IDENTITIES",
      message: "--identities requires at least one non-blank value",
    };
    throw error;
  }
  return identities;
}

/** Optional `--identities` as a list, or undefined when the flag is absent. */
function parseOptionalIdentities(options: CommandOptions): string[] | undefined {
  const raw = stringOption(options, "identities");
  if (raw === undefined) return undefined;
  const identities = splitCsv(raw);
  if (identities.length === 0) {
    const error: CommandError = {
      code: "INVALID_IDENTITIES",
      message: "--identities requires at least one non-blank value",
    };
    throw error;
  }
  return identities;
}

export type UsersListResult = ListResult<User>;

export async function runUsersListCommand(
  options: CommandOptions,
  _command: Command,
): Promise<UsersListResult> {
  const target = resolveControlPlaneTarget(extractControlPlaneOptions(options));
  return { type: "list", data: await listUsers(target), schema: usersListSchema };
}

export async function runUsersShowCommand(
  username: string,
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<User>> {
  const target = resolveControlPlaneTarget(extractControlPlaneOptions(options));
  return { type: "single", data: await showUser(target, username), schema: usersShowSchema };
}

export async function runUsersAddCommand(
  username: string,
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<UserEditResult>> {
  const input = {
    username,
    identities: parseRequiredIdentities(options),
    name: stringOption(options, "name"),
  };
  const target = resolveControlPlaneTarget(extractControlPlaneOptions(options));
  const result = await addUser(target, input);
  return { type: "single", data: result, schema: usersEditSchema };
}

export async function runUsersEditCommand(
  username: string,
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<UserEditResult>> {
  const input = {
    name: stringOption(options, "name"),
    identities: parseOptionalIdentities(options),
  };
  const target = resolveControlPlaneTarget(extractControlPlaneOptions(options));
  const result = await editUser(target, username, input);
  return { type: "single", data: result, schema: usersEditSchema };
}

export function createUsersCommand(): Command {
  const users = new Command("users").description("Manage user records on the running Hub");

  addJsonOption(
    addControlPlaneTargetOptions(users.command("list").description("List user records")),
  ).action(withOutput(runUsersListCommand));

  addJsonOption(
    addControlPlaneTargetOptions(
      users
        .command("show")
        .description("Show a user record")
        .argument("<username>", "Username to show"),
    ),
  ).action(withOutput(runUsersShowCommand));

  addJsonOption(
    addControlPlaneTargetOptions(
      users
        .command("add")
        .description("Create a user record")
        .argument("<username>", "Username to create")
        .requiredOption("--identities <ids>", "Comma-separated identity values")
        .option("--name <n>", "Display name"),
    ),
  ).action(withOutput(runUsersAddCommand));

  addJsonOption(
    addControlPlaneTargetOptions(
      users
        .command("edit")
        .description("Update a user record's name and/or identities")
        .argument("<username>", "Username to update")
        .option("--identities <ids>", "Comma-separated identity values (replaces the current set)")
        .option("--name <n>", "Display name"),
    ),
  ).action(withOutput(runUsersEditCommand));

  return users;
}
