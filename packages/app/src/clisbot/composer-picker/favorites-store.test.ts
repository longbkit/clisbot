import { beforeEach, describe, expect, it } from "vitest";
import { isFavoriteModel, toggleFavoriteKey, useModelFavoritesStore } from "./favorites-store";

describe("model favorites", () => {
  beforeEach(() => {
    useModelFavoritesStore.setState({ keys: [] });
  });

  it("adds and removes a model, keeping the others in order", () => {
    expect(toggleFavoriteKey(["codex:a", "claude:b"], "codex:c")).toEqual([
      "codex:a",
      "claude:b",
      "codex:c",
    ]);
    expect(toggleFavoriteKey(["codex:a", "claude:b"], "codex:a")).toEqual(["claude:b"]);
  });

  it("stars a model on this device", () => {
    useModelFavoritesStore.getState().toggle("claude:opus");
    expect(isFavoriteModel(useModelFavoritesStore.getState().keys, "claude", "opus")).toBe(true);
    useModelFavoritesStore.getState().toggle("claude:opus");
    expect(useModelFavoritesStore.getState().keys).toEqual([]);
  });
});
