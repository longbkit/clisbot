/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentControlTrigger } from "./control";

beforeEach(() => vi.stubGlobal("React", React));

function TestIcon() {
  return null;
}

function noop() {}

describe("AgentControlTrigger", () => {
  it("forwards interaction handlers to the rendered trigger", () => {
    const onPointerEnter = vi.fn();
    const onFocus = vi.fn();
    const onPress = vi.fn();
    const view = render(
      <AgentControlTrigger
        icon={TestIcon}
        surface="toolbar"
        label="Mode"
        onPress={onPress}
        onPointerEnter={onPointerEnter}
        onFocus={onFocus}
        accessibilityLabel="Select mode"
      />,
    );
    const trigger = view.getByRole("button", { name: "Select mode" });

    fireEvent.pointerEnter(trigger);
    fireEvent.focus(trigger);

    expect(onPointerEnter).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it("renders a labeled selected switch for auto-accept", () => {
    const view = render(
      <AgentControlTrigger
        icon={TestIcon}
        surface="toolbar"
        label="Auto Accept"
        selected
        selectedBackgroundColor="rgba(41, 159, 81, 0.24)"
        iconColor="#3e704a"
        onPress={noop}
        accessibilityRole="switch"
        accessibilityLabel="Paseo auto-accepts permission prompts (On)"
      />,
    );
    const trigger = view.getByRole("switch", {
      name: "Paseo auto-accepts permission prompts (On)",
    });

    expect(trigger.getAttribute("role")).toBe("switch");
    expect(trigger.getAttribute("aria-checked")).toBe("true");
    expect(trigger.textContent).toContain("Auto Accept");
  });
});
