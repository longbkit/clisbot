// @vitest-environment jsdom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationSelectionFields } from "./conversation-picker-field";

const adapters = vi.hoisted(() => ({ get: vi.fn(), accountId: "owner" }));
vi.mock("../account-provider", () => ({
  useHubAccount: () => ({
    origin: "https://hub.test",
    signedIn: { account: { id: adapters.accountId }, organization: { id: "org" } },
    api: () => ({ get: adapters.get }),
  }),
}));
vi.mock("@/components/ui/form-field", () => ({
  Field: ({
    label,
    hint,
    children,
  }: {
    label: string;
    hint?: string;
    children: React.ReactNode;
  }) => (
    <div>
      <span>{label}</span>
      <span>{hint}</span>
      {children}
    </div>
  ),
  FormTextInput: React.forwardRef(function Input(
    {
      initialValue,
      onChangeText,
      editable,
    }: { initialValue: string; onChangeText(value: string): void; editable: boolean },
    ref: React.Ref<{ replaceText(value: string): void }>,
  ) {
    const [text, setText] = React.useState(initialValue);
    React.useImperativeHandle(ref, () => ({ replaceText: setText }), []);
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setText(event.target.value);
        onChangeText(event.target.value);
      },
      [onChangeText],
    );
    return (
      <textarea aria-label="Conversation IDs" value={text} disabled={!editable} onChange={change} />
    );
  }),
}));
vi.mock("@/components/ui/select-field", () => ({
  SelectFieldTrigger: ({ label }: { label: string }) => <span>{label}</span>,
}));
vi.mock("@/components/ui/combobox", () => ({
  Combobox: ({
    open,
    options,
    onSelect,
  }: {
    open: boolean;
    options: { id: string; label: string }[];
    onSelect(id: string): void;
  }) =>
    open ? (
      <div>
        {options.map((option) => (
          <Option key={option.id} id={option.id} label={option.label} onSelect={onSelect} />
        ))}
      </div>
    ) : null,
  ComboboxItem: () => null,
}));
function Option({
  id,
  label,
  onSelect,
}: {
  id: string;
  label: string;
  onSelect(id: string): void;
}) {
  const select = React.useCallback(() => onSelect(id), [id, onSelect]);
  return <button type="button" onClick={select}>{`Choose ${label}`}</button>;
}
function Harness({
  accountId = "support",
  kind = "channel",
}: {
  accountId?: string;
  kind?: "channel" | "group";
}) {
  const [value, setValue] = React.useState("C1");
  return (
    <>
      <ConversationSelectionFields
        channel="slack"
        accountId={accountId}
        kind={kind}
        value={value}
        onChange={setValue}
        disabled={false}
        hint="Select at least one conversation."
        placeholder="C1, C2"
      />
      <output aria-label="Canonical IDs">{value}</output>
    </>
  );
}
const observations = {
  conversations: [],
  destinations: [
    {
      id: "C1",
      kind: "channel",
      rootConversationId: "C1",
      threadId: null,
      label: "#support",
      visibility: "private",
      source: "provider",
    },
    {
      id: "C2",
      kind: "channel",
      rootConversationId: "C2",
      threadId: null,
      label: "#delivery",
      visibility: "public",
      source: "provider",
    },
  ],
};
let queryClient: QueryClient;
beforeEach(() => {
  vi.stubGlobal("React", React);
  adapters.accountId = "owner";
  adapters.get.mockReset().mockResolvedValue(observations);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});
function mount() {
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe("Conversation selection", () => {
  it("shows selected names and IDs, supports multiple choices, and removes only the requested selection", async () => {
    mount();
    expect(await screen.findByText("#support")).toBeTruthy();
    expect(screen.getByText("Channel · C1 · Private")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Choose conversations" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose #delivery" }));
    expect(screen.getByLabelText("Canonical IDs").textContent).toBe("C1, C2");
    fireEvent.click(screen.getByRole("button", { name: "Remove #support" }));
    expect(screen.getByLabelText("Canonical IDs").textContent).toBe("C2");
    fireEvent.click(screen.getByRole("button", { name: "Remove #delivery" }));
    expect(screen.getByText("No conversations selected.")).toBeTruthy();
    expect(screen.getByLabelText("Canonical IDs").textContent).toBe("");
  });

  it("uses the same selection for comma/newline manual entry and keeps it across disclosure changes", async () => {
    mount();
    await screen.findByText("#support");
    fireEvent.click(screen.getByRole("button", { name: "Enter IDs" }));
    fireEvent.change(screen.getByLabelText("Conversation IDs"), {
      target: { value: " C2\nC1, C2\nunknown " },
    });
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Remove unknown" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide ID entry" }));
    fireEvent.click(screen.getByRole("button", { name: "Enter IDs" }));
    expect((screen.getByLabelText("Conversation IDs") as HTMLTextAreaElement).value).toBe(
      " C2\nC1, C2\nunknown ",
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove #support" }));
    expect((screen.getByLabelText("Conversation IDs") as HTMLTextAreaElement).value).toBe(
      "C2, unknown",
    );
  });

  it.each(["account", "principal", "kind"])(
    "does not apply late names across a %s boundary",
    async (boundary) => {
      let resolve!: (value: typeof observations) => void;
      adapters.get
        .mockImplementationOnce(
          () =>
            new Promise((done) => {
              resolve = done;
            }),
        )
        .mockResolvedValue({ conversations: [] });
      const ui = mount();
      await waitFor(() => expect(adapters.get).toHaveBeenCalled());
      if (boundary === "principal") adapters.accountId = "other-owner";
      ui.rerender(
        <QueryClientProvider client={queryClient}>
          <Harness
            accountId={boundary === "account" ? "other" : "support"}
            kind={boundary === "kind" ? "group" : "channel"}
          />
        </QueryClientProvider>,
      );
      await act(async () => resolve(observations));
      expect(screen.queryByText("#support")).toBeNull();
      expect(screen.getByRole("button", { name: "Remove C1" })).toBeTruthy();
      expect(screen.getByLabelText("Canonical IDs").textContent).toBe("C1");
    },
  );

  it("keeps exact selected IDs usable when names cannot load", async () => {
    adapters.get.mockRejectedValue(new Error("Unavailable"));
    mount();
    expect(await screen.findByText(/Conversation names are unavailable/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove C1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enter IDs" }));
    expect((screen.getByLabelText("Conversation IDs") as HTMLTextAreaElement).value).toBe("C1");
  });
});
