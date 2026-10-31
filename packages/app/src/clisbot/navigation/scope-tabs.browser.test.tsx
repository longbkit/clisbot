import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnershipScope, ScopeCounts } from "./ownership";
import { ScopeTabs } from "./scope-tabs";
import { useNavigationStore } from "./store";

vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));

const COUNTS: ScopeCounts = { mine: 2, others: 1, all: 3 };

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("ScopeTabs", () => {
  // Work nobody can place is listed under For me and All, so the help explaining it sits there.
  it.each<[OwnershipScope, boolean]>([
    ["mine", true],
    ["others", false],
    ["all", true],
  ])("on %s shows the unknown-ownership help: %s", async (scope, shown) => {
    useNavigationStore.getState().setScope("home", scope);
    await act(async () => {
      root.render(<ScopeTabs section="home" counts={COUNTS} />);
    });
    expect(host.querySelector('[data-testid="home-scope"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="home-ownership-help"]') !== null).toBe(shown);
  });
});
