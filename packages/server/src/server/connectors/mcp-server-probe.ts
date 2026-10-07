import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { stdioServerEnv } from "./connector-env.js";
import { CLISBOT_MCP_IMPLEMENTATION } from "./connector-json.js";
import type { McpServerSecrets } from "./connector-store.js";

/**
 * Lists the tools of one MCP server the user added, for the detail page and the grant's
 * tool picker. Connects as an MCP client with the stored secrets, asks `tools/list`, disconnects.
 */

const PROBE_TIMEOUT_MS = 20_000;
const MAX_TOOL_PAGES = 20;

export interface McpServerProbeTarget {
  transport: "http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  secrets: McpServerSecrets;
}

export interface ProbedTool {
  name: string;
  title?: string;
  description?: string;
  /** The tool's `readOnlyHint` annotation, when it gives one. */
  readOnly?: boolean;
}

function createTransport(target: McpServerProbeTarget): Transport {
  if (target.transport === "http") {
    return new StreamableHTTPClientTransport(new URL(target.url ?? ""), {
      requestInit: { headers: target.secrets.headers },
    });
  }
  return new StdioClientTransport({
    command: target.command ?? "",
    args: target.args ?? [],
    env: stdioServerEnv(target.secrets.env),
    stderr: "ignore",
  });
}

export async function listMcpServerTools(target: McpServerProbeTarget): Promise<ProbedTool[]> {
  const client = new Client({ ...CLISBOT_MCP_IMPLEMENTATION });
  const transport = createTransport(target);
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  try {
    await client.connect(transport, { signal: timeout, timeout: PROBE_TIMEOUT_MS });
    const tools: ProbedTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
      const result = await client.listTools(cursor ? { cursor } : {}, {
        signal: timeout,
        timeout: PROBE_TIMEOUT_MS,
      });
      for (const tool of result.tools) {
        const title = tool.title ?? tool.annotations?.title;
        const readOnly = tool.annotations?.readOnlyHint;
        tools.push({
          name: tool.name,
          ...(title ? { title } : {}),
          ...(tool.description ? { description: tool.description } : {}),
          ...(typeof readOnly === "boolean" ? { readOnly } : {}),
        });
      }
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    return tools.sort((left, right) => left.name.localeCompare(right.name));
  } finally {
    await client.close().catch(() => undefined);
  }
}
