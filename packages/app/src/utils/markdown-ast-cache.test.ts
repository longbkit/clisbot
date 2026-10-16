import { expect, it, vi } from "vitest";
import { createAssistantMarkdownParser } from "./assistant-markdown-parser";

// The package entry loads React Native views; its parser module is plain JavaScript.
vi.mock("react-native-markdown-display", async () => ({
  // @ts-expect-error untyped package source module
  parser: (await import("react-native-markdown-display/src/lib/parser")).default,
}));
const { cacheMarkdownAst, readMarkdownAst } = await import("./markdown-ast-cache");

function shape(nodes: unknown): unknown {
  return JSON.parse(JSON.stringify(nodes, (key, value) => (key === "key" ? undefined : value)));
}

it("parses an opted-in parser's source once and returns the same tree to every mount", () => {
  const parser = cacheMarkdownAst(createAssistantMarkdownParser());
  const source = "Hello **world**, see https://example.com\n\n- one\n- two\n";
  const first = readMarkdownAst(parser, source);
  expect(Array.isArray(first)).toBe(true);
  expect(readMarkdownAst(parser, source)).toBe(first);
  expect(shape(readMarkdownAst(parser, `${source}- three\n`))).not.toEqual(shape(first));
});

it("matches the package's own tree for the same source", async () => {
  // @ts-expect-error untyped package source module
  const { default: parse } = await import("react-native-markdown-display/src/lib/parser");
  const parser = cacheMarkdownAst(createAssistantMarkdownParser());
  const source = "# Title\n\n`code` and [link](https://example.com)\n\n```ts\nconst x = 1;\n```\n";
  const own = parse(source, (nodes: unknown) => nodes, parser);
  expect(shape(readMarkdownAst(parser, source))).toEqual(shape(own));
});

it("leaves sources for parsers that did not opt in, such as streaming output", () => {
  const streaming = createAssistantMarkdownParser({ streaming: true });
  expect(readMarkdownAst(streaming, "partial **bo")).toBe("partial **bo");
});

it("evicts the least recently used trees beyond its source budget", () => {
  const parser = cacheMarkdownAst(createAssistantMarkdownParser());
  const old = readMarkdownAst(parser, "old reply");
  const kept = readMarkdownAst(parser, "kept reply");
  expect(readMarkdownAst(parser, "kept reply")).toBe(kept);
  readMarkdownAst(parser, "x".repeat(1_999_985));
  expect(readMarkdownAst(parser, "kept reply")).toBe(kept);
  expect(readMarkdownAst(parser, "old reply")).not.toBe(old);
});
