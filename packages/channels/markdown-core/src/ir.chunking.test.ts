// upstream: packages/markdown-core/src/ir.chunking.test.ts@5d8067a4483
// Markdown Core tests cover ir.chunking behavior.
import { describe, expect, it } from "vitest";
import { chunkMarkdownIR, type MarkdownIR } from "./ir.js";

describe("chunkMarkdownIR", () => {
  it("keeps the final in-limit remainder together after a soft break", () => {
    const ir: MarkdownIR = {
      text: "abcdefgh ij kl",
      styles: [],
      links: [],
    };

    expect(chunkMarkdownIR(ir, 10).map((chunk) => chunk.text)).toEqual(["abcdefgh", "ij kl"]);
  });
});
