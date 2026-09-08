// D-W6-02: the normalizer requires a table caption the tool schema marks
// optional, so a caption-less table used to disappear with no block, no
// fallback text and no error. Admission repairs it and reports every block that
// still did not survive.
import { describe, expect, it } from "vitest";
import { admitMessagePresentation } from "./presentation-admission.js";
import { normalizeMessagePresentation } from "./payload.js";

const TABLE_WITHOUT_CAPTION = {
  blocks: [
    {
      type: "table",
      headers: ["X", "Y", "Z"],
      rows: [
        [1, 2, 3],
        [4, 5, 6],
      ],
    },
  ],
};

describe("admitMessagePresentation", () => {
  it("keeps a caption-less table by defaulting the caption to its first header", () => {
    // The defect, reproduced on the verbatim normalizer.
    expect(normalizeMessagePresentation(TABLE_WITHOUT_CAPTION)?.blocks ?? []).toEqual([]);

    const admission = admitMessagePresentation(TABLE_WITHOUT_CAPTION);
    expect(admission.presentation?.blocks).toMatchObject([{ type: "table", caption: "X" }]);
    expect(admission.notes).toEqual([
      {
        index: 0,
        type: "table",
        outcome: "repaired",
        reason: 'table has no caption; used the first header ("X")',
      },
    ]);
  });

  it("leaves an authored caption alone", () => {
    const admission = admitMessagePresentation({
      blocks: [{ type: "table", caption: "Totals", headers: ["X"], rows: [[1]] }],
    });
    expect(admission.presentation?.blocks).toMatchObject([{ caption: "Totals" }]);
    expect(admission.notes).toEqual([]);
  });

  it("reports a block the normalizer refuses instead of dropping it silently", () => {
    const admission = admitMessagePresentation({
      blocks: [
        // Duplicate categories break the portable chart contract.
        {
          type: "chart",
          chartType: "bar",
          title: "Runs",
          categories: ["Mon", "Mon"],
          series: [{ name: "runs", values: [1, 2] }],
        },
      ],
    });
    expect(admission.presentation).toBeUndefined();
    expect(admission.notes).toEqual([
      {
        index: 0,
        type: "chart",
        outcome: "rejected",
        reason: "the chart block is not a valid presentation block and was not delivered",
      },
    ]);
  });

  it("passes a value that carries no blocks through unchanged", () => {
    expect(admitMessagePresentation(undefined)).toEqual({
      presentation: undefined,
      notes: [],
    });
  });
});
