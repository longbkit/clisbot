import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type { ToolPolicy } from "@getpaseo/protocol/agent-types";
import { z } from "zod";

/**
 * Where one ACP agent's permission request names an MCP server and tool.
 *
 * ACP has no standard field for that identity, so each agent puts it somewhere
 * else: Grok sends `rawInput.tool_name: "server__tool"`, Antigravity sends
 * `_meta.mcp: { server, tool }`. A provider that declares its shape gets exact
 * MCP preapproval: a request is allowed once only when `when` matches (a field
 * only MCP calls carry) and the identity equals a `toolPolicy.preapproved`
 * grant. Paths are dot-separated and start at the request's `toolCall`.
 */
const WhenSchema = z
  .record(z.string().min(1), z.union([z.string(), z.number(), z.boolean()]))
  .refine((when) => Object.keys(when).length > 0, "when needs at least one field");

const StructuredIdentitySchema = z
  .object({
    when: WhenSchema,
    server: z.string().min(1),
    tool: z.string().min(1),
  })
  .strict();

const FormattedIdentitySchema = z
  .object({
    when: WhenSchema,
    toolName: z.string().min(1),
    toolNameFormat: z
      .string()
      .refine(
        (format) => format.includes("{server}") && format.includes("{tool}"),
        "toolNameFormat must contain {server} and {tool}",
      ),
  })
  .strict();

export const ACPExactMcpPreapprovalSchema = z.union([
  StructuredIdentitySchema,
  FormattedIdentitySchema,
]);

export type ACPExactMcpPreapproval = z.infer<typeof ACPExactMcpPreapprovalSchema>;

type ToolCall = RequestPermissionRequest["toolCall"];

/** True when the request names exactly one of the granted MCP tools. */
export function matchesExactMcpPreapproval(
  declaration: ACPExactMcpPreapproval | undefined,
  toolPolicy: ToolPolicy | undefined,
  toolCall: ToolCall,
): boolean {
  const grants = toolPolicy?.preapproved ?? [];
  if (declaration === undefined || grants.length === 0) return false;
  const matchesWhen = Object.entries(declaration.when).every(
    ([path, expected]) => readPath(toolCall, path) === expected,
  );
  if (!matchesWhen) return false;
  if ("server" in declaration) {
    const server = readPath(toolCall, declaration.server);
    const tool = readPath(toolCall, declaration.tool);
    return grants.some((grant) => grant.server === server && grant.tool === tool);
  }
  const toolName = readPath(toolCall, declaration.toolName);
  return grants.some(
    (grant) =>
      declaration.toolNameFormat
        .replaceAll("{server}", grant.server)
        .replaceAll("{tool}", grant.tool) === toolName,
  );
}

function readPath(root: unknown, path: string): unknown {
  let current = root;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
