import { useCallback } from "react";
import type { QuickStartTarget } from "@clisbot/protocol/quick-starts/types";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { FieldControlSize } from "@/components/ui/control-geometry";
const ISOLATION = [
  { value: "local", label: "Local" },
  { value: "worktree", label: "New worktree" },
];
const BASE = [
  { value: "default", label: "Default branch" },
  { value: "ask", label: "Ask each time" },
  { value: "ref", label: "Branch" },
];
export function WorkspaceFields({
  target,
  onChange,
  size,
  supported,
  disabled,
}: {
  target: Extract<QuickStartTarget, { kind: "project" }>;
  onChange: (target: QuickStartTarget) => void;
  size: FieldControlSize;
  supported: boolean;
  disabled: boolean;
}) {
  const isolation = useCallback(
    (id: string) =>
      onChange({
        ...target,
        workspace:
          id === "local" ? { kind: "local" } : { kind: "worktree", base: { kind: "default" } },
      }),
    [target, onChange],
  );
  const base = useCallback(
    (id: string) =>
      onChange({
        ...target,
        workspace: {
          kind: "worktree",
          base: id === "ref" ? { kind: "ref", refName: "" } : { kind: id as "default" | "ask" },
        },
      }),
    [target, onChange],
  );
  const ref = useCallback(
    (refName: string) =>
      onChange({
        ...target,
        workspace: { kind: "worktree", base: { kind: "ref", refName } },
      }),
    [target, onChange],
  );
  if (!supported && target.workspace.kind === "local") return null;
  return (
    <>
      <Field
        label="Workspace"
        hint={
          target.workspace.kind === "worktree"
            ? "Create a fresh worktree for each start"
            : undefined
        }
      >
        <SegmentedControl
          options={ISOLATION.map((o) => ({
            value: o.value,
            label: o.label,
            disabled: disabled || (o.value === "worktree" && !supported),
          }))}
          value={target.workspace.kind}
          onValueChange={isolation}
          size={size}
        />
      </Field>
      {target.workspace.kind === "worktree" ? (
        <>
          <Field label="Start from">
            <SegmentedControl
              options={BASE.map((option) => Object.assign({}, option, { disabled }))}
              value={target.workspace.base.kind}
              onValueChange={base}
              size={size}
            />
          </Field>
          {target.workspace.base.kind === "ref" ? (
            <Field label="Branch">
              <FormTextInput
                initialValue={target.workspace.base.refName}
                onChangeText={ref}
                placeholder="main"
                size={size}
                editable={!disabled}
                accessibilityLabel="Branch"
              />
            </Field>
          ) : null}
        </>
      ) : null}
    </>
  );
}
