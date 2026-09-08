import { describe, expect, it } from "vitest";
import { createFeishuClient } from "../client.js";
import { buildFeishuTestConfig } from "./test-config.js";
import {
  collectFeishuToolRegistrations,
  registerFeishuTools,
  FEISHU_TOOL_NAMES,
  type FeishuToolRegistration,
} from "./tools.js";
import type { AnyAgentTool, OpenClawPluginToolContext } from "./runtime-api.js";

/**
 * The SDK boundary. `createFeishuClient` caches one client per account id, and
 * the ported tools resolve their client through that same cache, so replacing
 * the namespaces on the cached instance makes every executor run its real code
 * against a fake Lark API. Nothing about the tool factory, its schema or its
 * dispatch is stubbed.
 */
function fakeSdk(namespaces: Record<string, unknown>): void {
  const client = createFeishuClient({
    accountId: "default",
    appId: "cli_test_app",
    appSecret: "test-secret",
    domain: "feishu",
  }) as unknown as Record<string, unknown>;
  for (const [name, value] of Object.entries(namespaces)) client[name] = value;
}

function toolNamed(
  registrations: FeishuToolRegistration[],
  name: string,
  ctx: Partial<OpenClawPluginToolContext> = {},
): AnyAgentTool {
  for (const entry of registrations) {
    const built = typeof entry.tool === "function" ? entry.tool(ctx) : entry.tool;
    const tools = built === null || built === undefined ? [] : [built].flat();
    for (const tool of tools) {
      if (tool.name === name) return tool;
    }
  }
  throw new Error(`tool ${name} was not registered`);
}

/**
 * Runs a tool and returns its JSON payload. The ported `tool-result.ts` marks
 * `resultContentSource: "network"` results as untrusted external content, so
 * the text carries upstream's boundary markers around the JSON — the assertions
 * read the payload out of the envelope rather than pretending it is not there.
 */
async function run(tool: AnyAgentTool, params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute?.("call-1", params);
  const first = result?.content[0];
  if (first === undefined || first.type !== "text") return undefined;
  const start = first.text.indexOf("{");
  const end = first.text.lastIndexOf("}");
  expect(start).toBeGreaterThanOrEqual(0);
  return JSON.parse(first.text.slice(start, end + 1));
}

describe("Feishu tool registration", () => {
  it("registers the enabled families through upstream's entry points", () => {
    const registrations = collectFeishuToolRegistrations({ cfg: buildFeishuTestConfig() });
    const names = new Set<string>();
    for (const entry of registrations) {
      const built = typeof entry.tool === "function" ? entry.tool({}) : entry.tool;
      for (const tool of [built ?? []].flat()) names.add(tool.name);
      for (const declared of entry.options?.names ?? []) names.add(declared);
      if (entry.options?.name) names.add(entry.options.name);
    }
    // `perm` is off by default upstream (`tools-config.ts`), so `feishu_perm`
    // is the one contract name that must NOT be registered here.
    expect(names.has("feishu_doc")).toBe(true);
    expect(names.has("feishu_chat")).toBe(true);
    expect(names.has("feishu_wiki")).toBe(true);
    expect(names.has("feishu_drive")).toBe(true);
    expect(names.has("feishu_perm")).toBe(false);
    for (const name of names) expect(FEISHU_TOOL_NAMES).toContain(name);
  });

  it("registers feishu_perm once the account enables it", () => {
    const registrations = collectFeishuToolRegistrations({
      cfg: buildFeishuTestConfig({ tools: { perm: true } }),
    });
    expect(() => toolNamed(registrations, "feishu_perm")).not.toThrow();
  });

  it("registers nothing when every family is disabled", () => {
    const registrations = collectFeishuToolRegistrations({
      cfg: buildFeishuTestConfig({
        tools: {
          doc: false,
          chat: false,
          wiki: false,
          drive: false,
          perm: false,
          scopes: false,
          bitable: false,
        },
      }),
    });
    expect(registrations).toEqual([]);
  });

  it("forwards every registration to the Fusion registrar", () => {
    const forwarded: string[] = [];
    const registrations = registerFeishuTools(
      {
        registerTool: (tool) => {
          const built = typeof tool === "function" ? tool({}) : tool;
          for (const entry of [built ?? []].flat()) forwarded.push(entry.name);
        },
      },
      { cfg: buildFeishuTestConfig() },
    );
    expect(registrations.length).toBeGreaterThan(0);
    expect(forwarded).toContain("feishu_doc");
    expect(forwarded).toContain("feishu_drive");
  });
});

describe("feishu_doc", () => {
  it("creates a document through the SDK", async () => {
    const calls: Record<string, unknown>[] = [];
    fakeSdk({
      docx: {
        document: {
          create: async (request: Record<string, unknown>) => {
            calls.push(request);
            return { code: 0, data: { document: { document_id: "doc_new", title: "Notes" } } };
          },
        },
      },
      drive: {
        permissionMember: {
          create: async () => ({ code: 0, data: {} }),
        },
      },
    });
    const registrations = collectFeishuToolRegistrations({ cfg: buildFeishuTestConfig() });
    const tool = toolNamed(registrations, "feishu_doc");
    const result = (await run(tool, { action: "create", title: "Notes" })) as Record<
      string,
      unknown
    >;
    expect(calls[0]).toMatchObject({ data: { title: "Notes" } });
    expect(result).toMatchObject({ document_id: "doc_new" });
  });

  it("reads a document through the SDK", async () => {
    fakeSdk({
      docx: {
        document: {
          rawContent: async () => ({ code: 0, data: { content: "hello doc" } }),
          get: async () => ({
            code: 0,
            data: { document: { document_id: "doc_1", title: "Notes", revision_id: 3 } },
          }),
        },
        documentBlock: {
          list: async () => ({ code: 0, data: { items: [{ block_type: 2 }, { block_type: 2 }] } }),
        },
      },
    });
    const registrations = collectFeishuToolRegistrations({ cfg: buildFeishuTestConfig() });
    const tool = toolNamed(registrations, "feishu_doc");
    const result = (await run(tool, { action: "read", doc_token: "doc_1" })) as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(result)).toContain("hello doc");
  });

  it("refuses create with content, with upstream's guidance", async () => {
    const registrations = collectFeishuToolRegistrations({ cfg: buildFeishuTestConfig() });
    const tool = toolNamed(registrations, "feishu_doc");
    const result = (await run(tool, {
      action: "create",
      title: "Notes",
      content: "body",
    })) as Record<string, unknown>;
    expect(String(result.error)).toContain("does not support content");
  });
});

describe("feishu_drive", () => {
  it("lists a folder through the SDK", async () => {
    const calls: Record<string, unknown>[] = [];
    fakeSdk({
      drive: {
        file: {
          list: async (request: Record<string, unknown>) => {
            calls.push(request);
            return {
              code: 0,
              data: {
                files: [
                  { token: "fldr_1", name: "Design", type: "folder", url: "https://x/1" },
                  { token: "doc_2", name: "Spec", type: "docx", url: "https://x/2" },
                ],
                next_page_token: "page-2",
              },
            };
          },
        },
      },
    });
    const registrations = collectFeishuToolRegistrations({ cfg: buildFeishuTestConfig() });
    const tool = toolNamed(registrations, "feishu_drive");
    const result = (await run(tool, { action: "list", folder_token: "fldr_root" })) as {
      files: { token: string; name: string }[];
      next_page_token?: string;
    };
    expect(calls[0]).toMatchObject({ params: { folder_token: "fldr_root" } });
    expect(result.files.map((file) => file.name)).toEqual(["Design", "Spec"]);
    expect(result.next_page_token).toBe("page-2");
  });

  it("surfaces a Lark error code as a tool error", async () => {
    fakeSdk({
      drive: { file: { list: async () => ({ code: 99991663, msg: "app ticket invalid" }) } },
    });
    const registrations = collectFeishuToolRegistrations({ cfg: buildFeishuTestConfig() });
    const tool = toolNamed(registrations, "feishu_drive");
    const result = (await run(tool, { action: "list" })) as Record<string, unknown>;
    expect(String(JSON.stringify(result))).toContain("app ticket invalid");
  });
});
