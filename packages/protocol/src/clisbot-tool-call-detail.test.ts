import { describe, expect, it } from "vitest";

import { buildClisbotToolDetailSections } from "./clisbot-tool-call-detail.js";

describe("Clisbot tool-call detail presentation", () => {
  it.each(["mcp__clisbot__create_agent", "clisbot.create_agent", "clisbot_remote.create_agent"])(
    "shares one create-agent mapping for %s",
    (toolName) => {
      expect(
        buildClisbotToolDetailSections(
          toolName,
          {
            workspaceId: "wks_123",
            provider: "codex/gpt-5.4",
            title: "Greeter",
            initialPrompt: "Say hello back.\nDo nothing else.",
            notifyOnFinish: true,
          },
          { agentId: "agt_123", status: "idle" },
        ),
      ).toEqual([
        {
          kind: "prose",
          title: "Prompt",
          text: "Say hello back.\nDo nothing else.",
        },
        {
          kind: "fields",
          title: "Details",
          fields: [
            { label: "Title", value: "Greeter" },
            { label: "Provider", value: "codex/gpt-5.4" },
            { label: "Workspace", value: "wks_123" },
            { label: "Notify on finish", value: "Yes" },
          ],
        },
        {
          kind: "fields",
          title: "Result",
          fields: [
            { label: "Agent", value: "agt_123" },
            { label: "Status", value: "idle" },
          ],
        },
      ]);
    },
  );

  it("formats schedule cadence and nested settings without JSON syntax", () => {
    const sections = buildClisbotToolDetailSections(
      "mcp__clisbot__create_schedule",
      {
        prompt: "Say hello back.",
        cron: "0 9 * * 1",
        timezone: "Europe/Berlin",
        provider: "codex/gpt-5.4",
        maxRuns: 1,
      },
      {
        id: "sch_123",
        status: "active",
        nextRunAt: "2026-09-07T09:00:00.000Z",
        target: { type: "new-agent", mode: "read-only" },
      },
    );

    expect(sections?.slice(0, 2)).toMatchObject([
      { kind: "prose", title: "Prompt", text: "Say hello back." },
      {
        kind: "fields",
        title: "Details",
        fields: [
          { label: "Cron", value: "0 9 * * 1" },
          { label: "Timezone", value: "Europe/Berlin" },
          { label: "Provider", value: "codex/gpt-5.4" },
          { label: "Maximum runs", value: "1" },
        ],
      },
    ]);
    expect(JSON.stringify(sections)).not.toContain('\\"new-agent\\"');
    expect(sections?.at(-1)).toEqual({
      kind: "fields",
      title: "Result",
      fields: [
        { label: "ID", value: "sch_123" },
        { label: "Status", value: "active" },
        { label: "Next run", value: "2026-09-07T09:00:00.000Z" },
      ],
    });
  });

  it("unwraps MCP result envelopes instead of exposing JSON-encoded text", () => {
    expect(
      buildClisbotToolDetailSections(
        "mcp__clisbot__send_agent_prompt",
        { prompt: "Say hello back." },
        {
          meta: null,
          content: [
            {
              type: "text",
              text: '{"success":true,"status":"idle","lastMessage":"Hello back."}',
            },
          ],
          structuredContent: {
            success: true,
            status: "idle",
            lastMessage: "Hello back.",
          },
        },
      )?.at(-1),
    ).toEqual({
      kind: "fields",
      title: "Result",
      fields: [
        { label: "Status", value: "idle" },
        { label: "Last message", value: "Hello back." },
      ],
    });
  });

  it("uses readable fallback fields for newly added Clisbot tools", () => {
    expect(
      buildClisbotToolDetailSections(
        "mcp__clisbot__future_tool",
        { opaqueThing: ["one", "two"], enabled: false },
        { success: true },
      ),
    ).toEqual([
      {
        kind: "fields",
        title: "Details",
        fields: [
          { label: "Enabled", value: "No" },
          { label: "Opaque thing", value: "• one\n• two" },
        ],
      },
      {
        kind: "fields",
        title: "Result",
        fields: [{ label: "Success", value: "Yes" }],
      },
    ]);
  });

  it("leaves non-Clisbot tools alone", () => {
    expect(buildClisbotToolDetailSections("mcp__github__create_issue", {}, {})).toBeNull();
  });
});
