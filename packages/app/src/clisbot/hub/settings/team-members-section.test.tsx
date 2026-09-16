// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamMembersSection } from "./team-members-section";

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: (component: unknown) => component,
}));
vi.mock("@/styles/settings", () => ({ settingsStyles: {} }));
vi.mock("@/components/settings/headings/settings-section", () => ({
  SettingsSection: ({ title, children }: { title: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    onPress,
    children,
    disabled,
  }: {
    onPress(): void;
    children: ReactNode;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("./multi-select-field", () => ({
  MultiSelectField: ({
    label,
    hint,
    options,
    value,
    onChange,
  }: {
    label: string;
    hint?: string;
    options: { value: string; label: string; description?: string }[];
    value: readonly string[];
    onChange(value: string[]): void;
  }) => (
    <fieldset aria-label={label}>
      <p>{hint}</p>
      {options.map((option) => (
        <PickerOption
          key={option.value}
          option={option}
          checked={value.includes(option.value)}
          value={value}
          onChange={onChange}
        />
      ))}
    </fieldset>
  ),
}));

function PickerOption({
  option,
  checked,
  value,
  onChange,
}: {
  option: { value: string; label: string; description?: string };
  checked: boolean;
  value: readonly string[];
  onChange(value: string[]): void;
}) {
  const toggle = React.useCallback(
    () => onChange(checked ? value.filter((id) => id !== option.value) : [...value, option.value]),
    [checked, onChange, option.value, value],
  );
  return (
    <label>
      <input type="checkbox" checked={checked} onChange={toggle} />
      {`${option.label} ${option.description ?? ""}`}
    </label>
  );
}

const members = [
  { id: "m1", userId: "u1", name: "Admin IT", email: "it@vexere.com", role: "member" as const },
  {
    id: "m2",
    userId: "u2",
    name: "Designer VXR",
    email: "design@vexere.com",
    role: "member" as const,
  },
  { id: "m3", userId: "u3", name: "Long Luong", email: "long@vexere.com", role: "owner" as const },
];

beforeEach(() => vi.stubGlobal("React", React));
afterEach(cleanup);

describe("TeamMembersSection", () => {
  it("lists only Team Members and offers the rest of the organization in the picker", () => {
    render(
      <TeamMembersSection
        teamUserIds={["u2"]}
        members={members}
        pending={false}
        canManage
        addMembers={vi.fn(async (_userIds: string[]) => [] as string[])}
        removeMember={vi.fn()}
      />,
    );
    const picker = screen.getByRole("group", { name: "Add Members" });
    expect(within(picker).getByText(/Admin IT it@vexere.com · Member/)).toBeTruthy();
    expect(within(picker).getByText(/Long Luong long@vexere.com · Owner/)).toBeTruthy();
    expect(within(picker).queryByText(/Designer VXR/)).toBeNull();
    expect(screen.getByText("design@vexere.com · Member")).toBeTruthy();
    expect(screen.queryByText("it@vexere.com · Member")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
  });

  it("adds every picked Member in one action and removes one row", async () => {
    const addMembers = vi.fn(async (_userIds: string[]) => [] as string[]);
    const removeMember = vi.fn();
    render(
      <TeamMembersSection
        teamUserIds={["u2"]}
        members={members}
        pending={false}
        canManage
        addMembers={addMembers}
        removeMember={removeMember}
      />,
    );
    const addButton = screen.getByRole("button", { name: "Add to Team" }) as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Admin IT/));
    fireEvent.click(screen.getByLabelText(/Long Luong/));
    fireEvent.click(screen.getByRole("button", { name: "Add 2 Members" }));
    await waitFor(() => expect(addMembers).toHaveBeenCalledWith(["u1", "u3"]));
    expect(screen.getByRole("button", { name: "Add to Team" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(removeMember).toHaveBeenCalledWith("u2");
  });

  it("keeps refused Members picked for retry", async () => {
    const addMembers = vi.fn(async (_userIds: string[]) => ["u3"]);
    render(
      <TeamMembersSection
        teamUserIds={[]}
        members={members}
        pending={false}
        canManage
        addMembers={addMembers}
        removeMember={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Admin IT/));
    fireEvent.click(screen.getByLabelText(/Long Luong/));
    fireEvent.click(screen.getByRole("button", { name: "Add 2 Members" }));
    await waitFor(() =>
      expect((screen.getByLabelText(/Admin IT/) as HTMLInputElement).checked).toBe(false),
    );
    expect((screen.getByLabelText(/Long Luong/) as HTMLInputElement).checked).toBe(true);
  });

  it("shows the Team read-only without manage rights", () => {
    render(
      <TeamMembersSection
        teamUserIds={[]}
        members={members}
        pending={false}
        canManage={false}
        addMembers={vi.fn(async (_userIds: string[]) => [] as string[])}
        removeMember={vi.fn()}
      />,
    );
    expect(screen.queryByRole("group", { name: "Add Members" })).toBeNull();
    expect(screen.getByText("No Members in this Team yet")).toBeTruthy();
  });
});
