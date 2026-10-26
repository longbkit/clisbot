import { useCallback, useMemo } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostFeature } from "@/runtime/host-features";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { RadioList } from "@/clisbot/hub/settings/channel-route-audience-controls";
import type { QuickStartTarget } from "@clisbot/protocol/quick-starts/types";
import { findDestination, type QuickStartDestination } from "./model";
import type { QuickStartForm, QuickStartFormState } from "./form-model";
import { WorkspaceFields } from "./workspace-fields";
import { AgentFields } from "./agent-fields";
import { styles } from "./styles";
const VISIBILITY = [
  {
    value: "personal",
    label: "Only me",
    description: "Available on your devices connected to this Host",
  },
  {
    value: "host",
    label: "Share on this Host",
    description: "People with access to the destination can use it and pin it to their Home",
  },
] as const;
const ON_TAP = [
  {
    value: "fill",
    label: "Fill the composer",
    description: "Review or change the prompt, then send",
  },
  {
    value: "send",
    label: "Send right away",
    description:
      "One tap starts the chat. It fills the composer instead when settings need a check or the composer has attachments",
  },
] as const;
export function QuickStartEditor({
  targetOpen,
  setTargetOpen,
  edit,
  form,
  destinations,
  serverId,
  busy,
}: {
  targetOpen: boolean;
  setTargetOpen: (open: boolean) => void;
  edit: QuickStartFormState;
  form: QuickStartForm;
  destinations: QuickStartDestination[];
  serverId: string;
  busy: boolean;
}) {
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const input = edit.input;
  const destination = findDestination(destinations, input.target);
  const setName = useCallback((name: string) => form.change({ ...input, name }), [input, form]);
  const prompt = useCallback(
    (startingPrompt: string) => form.change({ ...input, startingPrompt }),
    [input, form],
  );
  const share = useCallback(
    (visibility: "personal" | "host") => form.change({ ...input, visibility }),
    [input, form],
  );
  const autoSendSupported = useHostFeature(serverId, "quickStartAutoSend");
  const onTap = useCallback(
    (value: "fill" | "send") => form.change({ ...input, autoSend: value === "send" }),
    [input, form],
  );
  return (
    <>
      <Field label="Name">
        <FormTextInput
          initialValue={input.name}
          onChangeText={setName}
          placeholder="Fix a bug"
          size={size}
          editable={!busy}
          accessibilityLabel="Name"
          testID="quick-start-name"
        />
      </Field>
      <DestinationFields
        edit={edit}
        form={form}
        destinations={destinations}
        size={size}
        busy={busy}
        targetOpen={targetOpen}
        setTargetOpen={setTargetOpen}
      />
      <Field label="Starting prompt">
        <FormTextInput
          multiline
          initialValue={input.startingPrompt}
          onChangeText={prompt}
          placeholder="Investigate the issue, fix it, and run relevant tests"
          style={styles.prompt}
          size={size}
          editable={!busy}
          accessibilityLabel="Starting prompt"
          testID="quick-start-prompt"
        />
      </Field>
      <AgentFields
        form={form}
        state={edit}
        serverId={serverId}
        cwd={destination?.cwd}
        size={size}
        disabled={busy}
      />
      {autoSendSupported ? (
        <RadioList
          label="When you tap it"
          options={ON_TAP}
          selected={input.autoSend ? "send" : "fill"}
          onChange={onTap}
          disabled={busy}
        />
      ) : null}
      <RadioList
        label="Who can use this"
        options={VISIBILITY}
        selected={input.visibility}
        onChange={share}
        disabled={busy}
      />
    </>
  );
}

function DestinationFields({
  edit,
  form,
  destinations,
  size,
  busy,
  targetOpen,
  setTargetOpen,
}: {
  edit: QuickStartFormState;
  form: QuickStartForm;
  destinations: QuickStartDestination[];
  size: "sm" | "md";
  busy: boolean;
  targetOpen: boolean;
  setTargetOpen: (open: boolean) => void;
}) {
  const input = edit.input;
  const destination = findDestination(destinations, input.target);
  const options = useMemo(
    () => destinations.map((d) => ({ ...d.option, value: d.option.id })),
    [destinations],
  );
  const setTarget = useCallback(
    (target: QuickStartTarget) => form.change({ ...input, target }),
    [input, form],
  );
  const select = useCallback(
    (id: string, display: { label: string }) => {
      const next = destinations.find((d) => d.option.id === id);
      if (next) form.setDestination({ ...input, target: next.target }, display);
    },
    [destinations, form, input],
  );
  return (
    <>
      <SelectField
        label="Where to chat"
        value={destination?.option.id ?? null}
        selectedDisplay={edit.destinationDisplay}
        options={options}
        onChange={select}
        placeholder="Choose destination"
        emptyText="No destinations available"
        searchable
        title="Where to chat"
        size={size}
        triggerLeading={destination?.avatar}
        disabled={busy}
        open={targetOpen}
        onOpenChange={setTargetOpen}
        triggerTestID="quick-start-destination"
      />
      {input.target.kind === "project" ? (
        <WorkspaceFields
          disabled={busy}
          target={input.target}
          onChange={setTarget}
          size={size}
          supported={destination?.worktreeSupport === "supported"}
        />
      ) : null}
    </>
  );
}
