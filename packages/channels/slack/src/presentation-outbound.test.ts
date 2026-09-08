// The capability half of D-W6-01: the outbound seam renders a presentation
// natively only for the blocks Slack declares it can render. `outbound.test.ts`
// owns the posted-wire assertions; this pins the adaptation step, which is what
// a channel without `charts`/`tables` degrades through.
import { describe, expect, it } from "vitest";
import { resolveSlackOutboundPresentationMessages } from "./presentation-outbound.js";

const CHART_AND_TABLE = {
  blocks: [
    {
      type: "chart",
      chartType: "bar",
      title: "Weekly runs",
      categories: ["Mon", "Tue"],
      series: [{ name: "runs", values: [3, 5] }],
    },
    {
      type: "table",
      caption: "Totals",
      headers: ["A", "B"],
      rows: [[1, 2]],
    },
  ],
};

function blockTypesOf(result: ReturnType<typeof resolveSlackOutboundPresentationMessages>) {
  return result.messages.flatMap((message) =>
    (message.blocks ?? []).map((block) => (block as { type?: string }).type),
  );
}

describe("resolveSlackOutboundPresentationMessages", () => {
  it("compiles chart and table blocks with the vertical's declared capabilities", () => {
    const result = resolveSlackOutboundPresentationMessages({
      text: "Here is the summary",
      presentation: CHART_AND_TABLE,
    });
    expect(blockTypesOf(result)).toEqual(expect.arrayContaining(["data_visualization"]));
    expect(blockTypesOf(result)).toEqual(expect.arrayContaining(["data_table"]));
    expect(result.notes).toEqual([]);
  });

  it("degrades to text when the capabilities carry no charts or tables", () => {
    const result = resolveSlackOutboundPresentationMessages({
      text: "Here is the summary",
      presentation: CHART_AND_TABLE,
      capabilities: { supported: true, charts: false, tables: false },
    });
    expect(blockTypesOf(result)).not.toContain("data_visualization");
    expect(blockTypesOf(result)).not.toContain("data_table");
    // The values still reach the conversation — the fallback text carries them.
    expect(result.messages.map((message) => message.text).join("\n")).toContain("Weekly runs");
  });

  it("returns no message for a value that is not a presentation", () => {
    expect(
      resolveSlackOutboundPresentationMessages({ text: "plain", presentation: undefined }),
    ).toEqual({ messages: [], notes: [] });
  });

  it("posts a caption-less table and reports the repair (D-W6-02)", () => {
    const result = resolveSlackOutboundPresentationMessages({
      text: "Totals",
      presentation: {
        blocks: [{ type: "table", headers: ["A", "B"], rows: [[1, 2]] }],
      },
    });
    expect(blockTypesOf(result)).toContain("data_table");
    expect(result.notes).toEqual([
      {
        index: 0,
        type: "table",
        outcome: "repaired",
        reason: 'table has no caption; used the first header ("A")',
      },
    ]);
  });
});
