import { describe, expect, test } from "bun:test";
import { readJsonFile, withJsonFileMutation } from "../src/infra/json-storage.ts";
import { tempPath } from "./support/api-channel-helpers.ts";

type ItemsDocument = {
  items: string[];
};

function emptyItemsDocument(): ItemsDocument {
  return { items: [] };
}

function normalizeItemsDocument(value: unknown): ItemsDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyItemsDocument();
  }
  const items = (value as Partial<ItemsDocument>).items;
  return {
    items: Array.isArray(items) ? items.map(String) : [],
  };
}

describe("json storage", () => {
  test("serializes concurrent mutations through one file", async () => {
    const path = tempPath("state.json");
    const items = Array.from({ length: 24 }, (_, index) => `item-${index}`);

    await Promise.all(items.map((item) =>
      withJsonFileMutation(
        path,
        {
          fallback: emptyItemsDocument,
          normalize: normalizeItemsDocument,
        },
        (document) => {
          document.items.push(item);
        },
      )
    ));

    const document = await readJsonFile(path, {
      fallback: emptyItemsDocument,
      normalize: normalizeItemsDocument,
    });
    expect(document.items.slice().sort()).toEqual(items.slice().sort());
  });

  test("allows concurrent readers while mutations are writing", async () => {
    const path = tempPath("state.json");
    const items = Array.from({ length: 24 }, (_, index) => `item-${index}`);
    const options = {
      fallback: emptyItemsDocument,
      normalize: normalizeItemsDocument,
    };

    const writes = Promise.all(items.map((item) =>
      withJsonFileMutation(path, options, async (document) => {
        document.items.push(item);
        await Bun.sleep(1);
      })
    ));
    const reads = Promise.all(Array.from({ length: 48 }, async () => {
      await Bun.sleep(1);
      const document = await readJsonFile(path, options);
      expect(Array.isArray(document.items)).toBe(true);
    }));

    await Promise.all([writes, reads]);
    const document = await readJsonFile(path, options);
    expect(document.items.slice().sort()).toEqual(items.slice().sort());
  });
});
