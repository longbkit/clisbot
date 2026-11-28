import { KeyboardActionDispatcherProvider } from "@/keyboard/keyboard-action-dispatcher-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment jsdom
import React, { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import {
  ComposerPickerControls,
  type ComposerPickerControlsProps,
} from "./composer-picker-controls";

/**
 * In a live session another provider's model opens the provider-switch review. The model panel
 * closes before it, so only one overlay is open and none is left over the new draft.
 */

vi.mock("@/runtime/host-features", () => ({ useHostFeature: () => true }));
vi.mock("@/clisbot/composer-layout/frame-anchor", () => ({
  useComposerFrameAnchor: (fallback: unknown) => fallback,
}));
vi.mock("./model-chip", async () => {
  const { forwardRef } = await import("react");
  return {
    ModelChip: forwardRef((props: { onPress: () => void }, _ref) => (
      <button type="button" data-testid="model-chip" onClick={props.onPress}>
        chip
      </button>
    )),
  };
});
vi.mock("./mode-dropdown", () => ({ ModeDropdown: () => null }));
vi.mock("./model-picker", async () => {
  const { useCallback } = await import("react");
  function ModelPicker(props: {
    open: boolean;
    onPickModel: (provider: string, modelId: string) => void;
    onPickModelWithEffort?: (provider: string, modelId: string, effortId: string) => void;
  }) {
    const { onPickModel, onPickModelWithEffort } = props;
    const pick = useCallback(
      (event: { currentTarget: HTMLButtonElement }) => {
        const { provider = "", model = "", effort } = event.currentTarget.dataset;
        if (effort) onPickModelWithEffort?.(provider, model, effort);
        else onPickModel(provider, model);
      },
      [onPickModel, onPickModelWithEffort],
    );
    if (!props.open) return null;
    return (
      <div role="dialog" data-testid="model-picker">
        <button
          type="button"
          data-testid="pick-own"
          data-provider="codex"
          data-model="gpt-b"
          onClick={pick}
        />
        <button
          type="button"
          data-testid="pick-other"
          data-provider="claude"
          data-model="opus"
          onClick={pick}
        />
        <button
          type="button"
          data-testid="pick-other-effort"
          data-provider="claude"
          data-model="opus"
          data-effort="high"
          onClick={pick}
        />
      </div>
    );
  }
  return { ModelPicker };
});

beforeAll(() => {
  vi.stubGlobal("React", React);
});
afterEach(() => cleanup());

/** Stands in for the live composer: a pick from another provider opens the switch review. */
function Harness(props: { closeOnProviderChange?: boolean; onPick: () => void }) {
  const [review, setReview] = useState(false);
  const [queryClient] = useState(() => new QueryClient());
  const controls: ComposerPickerControlsProps = {
    provider: "codex",
    providers: [],
    selectedModelId: "gpt-a",
    onPickModel: (provider) => {
      props.onPick();
      if (provider !== "codex") setReview(true);
    },
    closeOnProviderChange: props.closeOnProviderChange,
    thinkingOptions: [],
    selectedThinkingOptionId: undefined,
    onSelectThinking: () => undefined,
    features: [],
    onSetFeature: () => undefined,
    modeControl: null,
    profiles: null,
    serverId: "srv",
    disabled: false,
    isModelLoading: false,
    isCompact: false,
    showEffort: true,
    showModeLabel: true,
    glyphSize: 16,
  };
  return (
    <>
      <QueryClientProvider client={queryClient}>
        <KeyboardActionDispatcherProvider>
          <ComposerPickerControls {...controls} />
        </KeyboardActionDispatcherProvider>
      </QueryClientProvider>
      {review ? <div role="dialog" data-testid="provider-switch-review" /> : null}
    </>
  );
}

function press(testID: string) {
  act(() => {
    fireEvent.click(screen.getByTestId(testID));
  });
}

test("a live session's pick from another provider closes the panel: only the review is open", () => {
  const onPick = vi.fn();
  render(<Harness closeOnProviderChange onPick={onPick} />);
  press("model-chip");
  expect(screen.getByTestId("model-picker")).toBeTruthy();
  press("pick-other");
  expect(onPick).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("model-picker")).toBeNull();
  expect(screen.getAllByRole("dialog").map((dialog) => dialog.dataset.testid)).toEqual([
    "provider-switch-review",
  ]);
});

test("picking another provider with an effort closes the panel the same way", () => {
  render(<Harness closeOnProviderChange onPick={vi.fn()} />);
  press("model-chip");
  press("pick-other-effort");
  expect(screen.getAllByRole("dialog").map((dialog) => dialog.dataset.testid)).toEqual([
    "provider-switch-review",
  ]);
});

test("a model of the session's own provider keeps the panel open for its effort", () => {
  render(<Harness closeOnProviderChange onPick={vi.fn()} />);
  press("model-chip");
  press("pick-own");
  expect(screen.getByTestId("model-picker")).toBeTruthy();
  expect(screen.queryByTestId("provider-switch-review")).toBeNull();
});

test("a draft, which changes provider in place, keeps the panel as before", () => {
  render(<Harness onPick={vi.fn()} />);
  press("model-chip");
  press("pick-other");
  expect(screen.getByTestId("model-picker")).toBeTruthy();
});
