// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdvancedConfigurationSection, useChannelYamlForm } from "./channel-advanced-configuration";

// Native editing input is adapted; the editor, document parser and form lifetime are real.
vi.mock("@/components/ui/form-field", () => ({
  Field: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label>
      {label}
      {children}
    </label>
  ),
  FormTextInput: function Input({
    initialValue,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    initialValue: string;
    onChangeText(value: string): void;
    editable: boolean;
    accessibilityLabel: string;
  }) {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLTextAreaElement>) => onChangeText(event.target.value),
      [onChangeText],
    );
    return (
      <textarea
        aria-label={accessibilityLabel}
        defaultValue={initialValue}
        onChange={change}
        disabled={!editable}
      />
    );
  },
}));
function Surface(props: Omit<React.ComponentProps<typeof AdvancedConfigurationSection>, "model">) {
  const model = useChannelYamlForm(props.channels);
  return <AdvancedConfigurationSection {...props} model={model} />;
}

const channels = {
  revision: { id: "revision-1", version: 1, createdAt: "2026-09-05T00:00:00Z" },
  resource: { shared: { daemonId: "host-1", projectId: "project-1" } },
  policy: { enabled: true },
  accounts: [{ accountId: "support", channel: "slack", routes: [] }],
  effective: {},
};
const latest = {
  ...channels,
  revision: { ...channels.revision, id: "revision-2", version: 2 },
  accounts: [],
};
beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const open = () => fireEvent.click(screen.getByRole("button", { name: "Advanced YAML" }));
const input = () =>
  screen.getByRole("textbox", { name: "Channel configuration YAML" }) as HTMLTextAreaElement;

it("starts collapsed and preserves the complete edited document when hidden and reopened", () => {
  const validate = vi.fn();
  const save = vi.fn();
  render(<Surface channels={channels} pending={false} validate={validate} save={save} />);
  expect(screen.queryByRole("textbox")).toBeNull();
  open();
  const draft = `${input().value}\n# keep this draft`;
  fireEvent.change(input(), { target: { value: draft } });
  fireEvent.click(screen.getByRole("button", { name: "Hide Advanced YAML" }));
  open();
  expect(input().value).toBe(draft);
  expect(validate).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it("preserves dirty text after a new revision and requires explicit reload before activation", () => {
  const validate = vi.fn();
  const save = vi.fn();
  const view = render(
    <Surface channels={channels} pending={false} validate={validate} save={save} />,
  );
  open();
  const draft = `${input().value}\n# my edit`;
  fireEvent.change(input(), { target: { value: draft } });
  view.rerender(<Surface channels={latest} pending={false} validate={validate} save={save} />);
  expect(input().value).toBe(draft);
  expect(screen.getByText("Configuration changed while you were editing")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Activate YAML" }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Discard edits and reload" }));
  expect(input().value).toContain("accounts: []");
  expect(input().value).not.toContain("# my edit");
});

it("ignores delayed validation for an edited draft and keeps activation errors beside the editor", async () => {
  let finish!: () => void;
  const validate = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const save = vi.fn().mockResolvedValue(false);
  const view = render(
    <Surface channels={channels} pending={false} validate={validate} save={save} />,
  );
  open();
  fireEvent.click(screen.getByRole("button", { name: "Validate" }));
  fireEvent.change(input(), { target: { value: `${input().value}\n# updated` } });
  await act(async () => finish());
  expect(screen.queryByText("Configuration is valid. Nothing was activated.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Activate YAML" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  view.rerender(
    <Surface
      channels={channels}
      pending={false}
      error="Revision changed; refresh before saving."
      validate={validate}
      save={save}
    />,
  );
  expect(screen.getByText("Revision changed; refresh before saving.")).toBeDefined();
  expect(input().value).toContain("# updated");
});
