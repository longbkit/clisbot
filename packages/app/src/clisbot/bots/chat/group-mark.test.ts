import { describe, expect, test } from "vitest";
import { mosaicCells } from "./group-mark";

const bot = (id: string) => ({ botId: id, name: id });

describe("mosaicCells", () => {
  test("splits two members into halves with a seam", () => {
    const cells = mosaicCells([bot("a"), bot("b")], 33);
    expect(cells.map(({ left, width, height }) => [left, width, height])).toEqual([
      [0, 16, 33],
      [17, 16, 33],
    ]);
  });

  test("gives three members a half and two quarters", () => {
    const cells = mosaicCells([bot("a"), bot("b"), bot("c")], 33);
    expect(cells.map((cell) => cell.member?.botId)).toEqual(["a", "b", "c"]);
    expect(cells[0].height).toBe(33);
    expect(cells[2]).toMatchObject({ left: 17, top: 17, height: 16 });
  });

  test("quarters four members and folds the rest into +N", () => {
    expect(mosaicCells([bot("a"), bot("b"), bot("c"), bot("d")], 33)[3].member?.botId).toBe("d");
    const crowded = mosaicCells(["a", "b", "c", "d", "e", "f"].map(bot), 33);
    expect(crowded).toHaveLength(4);
    expect(crowded[3]).toMatchObject({ overflow: 3 });
    expect(crowded[3].member).toBeUndefined();
  });

  test("draws nothing without members, so the mark falls back to the people glyph", () => {
    expect(mosaicCells([], 32)).toEqual([]);
  });
});
