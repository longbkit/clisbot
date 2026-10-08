import { afterEach, describe, expect, it } from "vitest";
import { AGENT_TOOL_GROUPS } from "@clisbot/protocol/connectors/agent-tools";
import { i18n } from "@/i18n/i18next";
import { connectorTools } from "@/i18n/resources/connectors/tools";
import {
  agentToolCatalogKey,
  agentToolDescription,
  agentToolGroupDescription,
  agentToolGroupLabel,
} from "./agent-tool-copy";

const catalog = connectorTools.en.catalog;
const groups: Record<string, { label: string; description: string } | undefined> = catalog.groups;
const tools: Record<string, string | undefined> = catalog.tools;

describe("agent tool copy", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("keeps the English catalog equal to the protocol's groups and tools", () => {
    const toolKeys: string[] = [];
    for (const group of AGENT_TOOL_GROUPS) {
      expect(groups[agentToolCatalogKey(group.id)]).toEqual({
        label: group.label,
        description: group.description,
      });
      for (const tool of group.tools) {
        toolKeys.push(agentToolCatalogKey(tool.name));
        expect(tools[agentToolCatalogKey(tool.name)]).toBe(tool.description);
      }
    }
    expect(Object.keys(tools).sort()).toEqual(toolKeys.sort());
    expect(Object.keys(groups).sort()).toEqual(
      AGENT_TOOL_GROUPS.map((group) => agentToolCatalogKey(group.id)).sort(),
    );
  });

  it("shows the protocol English in English", () => {
    const browser = AGENT_TOOL_GROUPS[0]!;
    expect(agentToolGroupLabel(browser)).toBe(browser.label);
    expect(agentToolGroupDescription(browser)).toBe(browser.description);
    expect(agentToolDescription(browser.tools[0]!)).toBe(browser.tools[0]!.description);
  });

  it("translates a known tool in another language", async () => {
    await i18n.changeLanguage("vi");
    const browser = AGENT_TOOL_GROUPS[0]!;
    expect(agentToolGroupLabel(browser)).toBe("Trình duyệt");
    expect(agentToolDescription({ name: "browser_list_tabs", description: "List open tabs" })).toBe(
      "Liệt kê các tab đang mở",
    );
  });

  it("falls back to the English of a group or tool the catalog does not know", async () => {
    await i18n.changeLanguage("vi");
    const tool = { name: "brand_new.tool", description: "Do something new" };
    expect(agentToolDescription(tool)).toBe("Do something new");
    const group = { id: "later", label: "Later", description: "Added later" };
    expect(agentToolGroupLabel(group)).toBe("Later");
    expect(agentToolGroupDescription(group)).toBe("Added later");
  });

  it("maps characters a key cannot hold to underscores", () => {
    expect(agentToolCatalogKey("brand_new.tool-2")).toBe("brand_new_tool_2");
  });
});
