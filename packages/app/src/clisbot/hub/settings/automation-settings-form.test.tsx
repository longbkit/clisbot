import { AutomationWorkflowEditor } from "./automation-workflow-editor";
import { parse } from "yaml";
// @vitest-environment jsdom
import { AutomationReplyNavigationContext } from "./automation-reply-navigation";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSingleAgentAutomationYaml,
  parseSingleAgentAutomationYaml,
} from "../automation-configuration";
import { AutomationSettings, SingleAgentAutomationForm } from "./automation-settings";

const page = vi.hoisted(() => ({
  enabled: false,
  resources: {} as Record<string, unknown>,
}));
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({
    visible,
    header,
    children,
    footer,
  }: {
    visible: boolean;
    header: { title: string };
    children: ReactNode;
    footer: ReactNode;
  }) =>
    visible ? (
      <div role="dialog" aria-label={header.title}>
        {children}
        {footer}
      </div>
    ) : null,
}));
vi.mock("@/components/ui/segmented-control", () => ({
  SegmentedControl: ({
    options,
    onValueChange,
  }: {
    options: { value: string; label: string }[];
    onValueChange(value: string): void;
  }) => (
    <nav>
      {options.map((option) => (
        <button key={option.value} onClick={() => onValueChange(option.value)}>
          {option.label}
        </button>
      ))}
    </nav>
  ),
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({ hidden: { display: "none" } }) },
  withUnistyles: (Component: React.ComponentType) => Component,
}));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("@/styles/settings", () => ({ settingsStyles: {} }));
vi.mock("../account-provider", () => ({
  useHubAccount: () => ({
    enabled: page.enabled,
    origin: "https://hub.example.test",
    signedIn: page.enabled
      ? {
          organization: { id: "org" },
          account: { id: "owner" },
          capabilities: { manageResources: true },
        }
      : null,
  }),
}));
vi.mock("@/data/query", () => ({
  useFetchQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: page.resources[String(queryKey[queryKey.length - 1])],
    isPending: false,
    error: null,
    refetch: async () => undefined,
  }),
}));
vi.mock("./daemon-project-field", () => ({
  DaemonProjectField: function ProjectTargetAdapter(props: {
    daemonId: string | null;
    serverId: string | null;
    cwd: string;
    onChange(projectId: string): void;
    onCwdChange(cwd: string): void;
    disabled: boolean;
  }) {
    const select = React.useCallback(() => {
      props.onChange("next-project");
      props.onCwdChange("/next/project-root");
    }, [props]);
    return (
      <div>
        <output aria-label="Selected working directory">{props.cwd}</output>
        <output aria-label="Selected Host runtime">{props.serverId ?? ""}</output>
        <button type="button" disabled={props.disabled || props.daemonId === null} onClick={select}>
          Choose next Project
        </button>
      </div>
    );
  },
}));
vi.mock("./managed-workspace-fields", () => ({ ManagedWorkspaceFields: () => null }));
vi.mock("./managed-agent-configuration-fields", () => ({
  ManagedAgentConfigurationFields: () => null,
}));
vi.mock("@/components/ui/select-field", () => ({
  SelectField: function TestSelect(props: {
    label: string;
    value: string | null;
    options: { id: string; value: string; label: string }[];
    onChange(value: string): void;
  }) {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLSelectElement>) => props.onChange(event.target.value),
      [props],
    );
    return (
      <select aria-label={props.label} value={props.value ?? ""} onChange={change}>
        <option value="">Choose</option>
        {props.options.map((option) => (
          <option key={option.id} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  },
}));
vi.mock("@/components/ui/alert", () => ({
  Alert: ({ title }: { title: string }) => <div role="alert">{title}</div>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    onPress,
    children,
    disabled,
    accessibilityLabel,
  }: {
    accessibilityLabel?: string;
    onPress(): void;
    children: ReactNode;
    disabled?: boolean;
  }) => (
    <button type="button" aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    value,
    onValueChange,
    accessibilityLabel,
    disabled,
  }: {
    value: boolean;
    onValueChange(value: boolean): void;
    accessibilityLabel: string;
    disabled?: boolean;
  }) => (
    <input
      type="checkbox"
      aria-label={accessibilityLabel}
      checked={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.checked)}
    />
  ),
}));
vi.mock("@/components/ui/form-field", () => ({
  Field: ({ label, children }: { label: string; children: ReactNode }) => (
    <label>
      {label}
      {children}
    </label>
  ),
  FormTextInput: ({
    initialValue,
    onChangeText,
    editable,
  }: {
    initialValue: string;
    onChangeText(value: string): void;
    editable?: boolean;
  }) => (
    <input
      defaultValue={initialValue}
      disabled={editable === false}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
}));
vi.mock("@/screens/settings/settings-section", () => ({
  SettingsSection: ({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) => (
    <section>
      {trailing}
      {children}
    </section>
  ),
}));
function ChannelDraftAdapter() {
  const configure = React.useContext(AutomationReplyNavigationContext);
  return (
    <div>
      <input aria-label="Route draft" />
      <button onClick={configure ?? undefined}>Configure reply output</button>
    </div>
  );
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  page.enabled = false;
  page.resources = {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const daemons = [
  { id: "daemon", slug: "Workstation", connectionOffer: { serverId: "runtime" } },
  { id: "next-daemon", slug: "Other Host", connectionOffer: { serverId: "next-runtime" } },
];

describe("Channel Automation form", () => {
  it("opens reply settings directly and keeps parameters separate from sources", () => {
    const save = vi.fn();
    render(
      <AutomationWorkflowEditor
        source={buildSingleAgentAutomationYaml({
          name: "reply",
          instruction: "Respond",
          events: [],
          daemonId: "daemon",
          cwd: "/workspace",
          provider: "pi",
        })}
        daemons={daemons}
        pending={false}
        save={save}
        ChannelInputs={ChannelDraftAdapter}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Configure reply output" }));
    expect(screen.getByRole("checkbox", { name: "slack replies for run" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Add parameter" }));
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Workflow" }));
    expect(parse(save.mock.calls[0][0]).inputs).toEqual({ parameter_1: { type: "string" } });
    expect(screen.queryByRole("textbox", { name: "Workflow YAML" })).toBeNull();
  });
  it("adds a second Agent, connects the first output, and grants replies only on the response step", () => {
    const initialValue = parseSingleAgentAutomationYaml(
      buildSingleAgentAutomationYaml({
        name: "classify-work",
        instruction: "Classify",
        events: [],
        daemonId: "daemon",
        projectId: "project",
        cwd: "/workspace",
        provider: "pi",
        outputSchema: { type: "object", properties: { category: { type: "string" } } },
      }),
    );
    const save = vi.fn();
    render(
      <AutomationWorkflowEditor
        source={buildSingleAgentAutomationYaml({
          ...initialValue!,
          projectId: initialValue?.projectId ?? undefined,
        })}
        daemons={daemons}
        pending={false}
        save={save}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    expect(screen.getAllByRole("button", { name: "Edit step" })).toHaveLength(2);
    expect(screen.queryByLabelText("Workflow YAML")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    fireEvent.change(screen.getByLabelText("Previous output"), {
      target: { value: "${{ steps.run.outputs.category }}" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Result" }));
    fireEvent.click(screen.getByLabelText("slack replies for step_2"));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Workflow" }));
    const value = parse(save.mock.calls[0][0]);
    expect(value.run).toBeUndefined();
    expect(value.steps).toHaveLength(2);
    expect(value.steps[1].prompt).toContainEqual({ text: "${{ steps.run.outputs.category }}" });
    expect(value.steps[0].allow_outputs).toEqual([]);
    expect(value.steps[1].allow_outputs).toEqual([{ type: "slack.reply", max: 1 }]);
  });
  it("adds GitHub through Add input and saves its filters separately from Parameters", () => {
    const initialValue = parseSingleAgentAutomationYaml(
      buildSingleAgentAutomationYaml({
        name: "review",
        instruction: "Review",
        events: [],
        daemonId: "daemon",
        projectId: "project",
        cwd: "/workspace",
        provider: "pi",
      }),
    );
    const save = vi.fn();
    render(
      <SingleAgentAutomationForm
        ChannelInputs={ChannelDraftAdapter}
        initialValue={initialValue}
        daemons={daemons}
        connections={[
          {
            id: "github",
            provider: "github",
            name: "github",
            externalName: null,
            status: "connected",
          },
        ]}
        existingNames={[]}
        pending={false}
        save={save}
      />,
    );
    expect(screen.queryByText("Slack mention")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add input" }));
    fireEvent.change(screen.getByLabelText("Input source"), {
      target: { value: "github.issue_comment" },
    });
    fireEvent.change(screen.getByLabelText("Connection"), { target: { value: "github" } });
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "org/repo" } });
    fireEvent.change(screen.getByLabelText("Comment contains"), {
      target: { value: "@bot review" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Activate Automation changes" }));
    expect(parseSingleAgentAutomationYaml(save.mock.calls[0]?.[0])?.events).toContainEqual({
      name: "github.issue_comment",
      connection: "github",
      allowedUsers: ["*"],
      repository: "org/repo",
      contains: "@bot review",
    });
    fireEvent.click(screen.getByRole("button", { name: "Add input" }));
    fireEvent.change(screen.getByLabelText("Input source"), { target: { value: "slack" } });
    expect(screen.getAllByLabelText("Allow Slack Channel replies")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Add parameter" })).toBeTruthy();
  });

  it("preserves an edited directory, clears it on Host change, and saves the selected Project root", () => {
    const initialValue = parseSingleAgentAutomationYaml(
      buildSingleAgentAutomationYaml({
        name: "triage",
        daemonId: "daemon",
        projectId: "project",
        cwd: "/saved/custom",
        provider: "codex",
        events: [{ name: "manual.run" }],
        instruction: "Reply",
      }),
    );
    if (initialValue === null) throw new Error("Expected editable Automation");
    const save = vi.fn();
    render(
      <SingleAgentAutomationForm
        initialValue={initialValue}
        daemons={daemons}
        connections={[]}
        existingNames={[]}
        pending={false}
        save={save}
      />,
    );
    expect(screen.getByLabelText("Selected working directory").textContent).toBe("/saved/custom");
    expect(screen.queryByLabelText("Working directory")).toBeNull();
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "next-daemon" } });
    expect(screen.getByLabelText("Selected working directory").textContent).toBe("");
    expect(screen.getByLabelText("Selected Host runtime").textContent).toBe("next-runtime");
    expect((screen.getByText("Activate Automation changes") as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose next Project" }));
    fireEvent.click(screen.getByText("Activate Automation changes"));
    expect(parseSingleAgentAutomationYaml(save.mock.calls[0]![0])).toMatchObject({
      daemonId: "next-daemon",
      projectId: "next-project",
      cwd: "/next/project-root",
    });
  });

  it("shows the new Route provider's bounded reply grant before creation", () => {
    render(
      <SingleAgentAutomationForm
        channelReplyProvider="telegram"
        daemons={daemons}
        connections={[]}
        existingNames={[]}
        pending={false}
        save={vi.fn()}
      />,
    );
    expect(
      (screen.getByLabelText("Allow Telegram Channel replies") as HTMLInputElement).checked,
    ).toBe(true);
    expect((screen.getByLabelText("Allow Slack Channel replies") as HTMLInputElement).checked).toBe(
      false,
    );
    expect((screen.getByLabelText("Maximum Telegram replies") as HTMLInputElement).value).toBe("1");
    expect(screen.getByText(/Finish and record the run; telegram.reply/)).toBeTruthy();
    expect(screen.queryByLabelText("Use Manual or API run")).toBeNull();
    expect(screen.getByRole("button", { name: "Add input" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add parameter" })).toBeTruthy();
  });

  it("preserves manual Channel reply grants on edit and removes one only after an explicit toggle", () => {
    const initialValue = parseSingleAgentAutomationYaml(
      buildSingleAgentAutomationYaml({
        name: "triage",
        daemonId: "daemon",
        projectId: "project",
        cwd: "/workspace",
        provider: "codex",
        events: [{ name: "manual.run" }],
        instruction: "Answer the request.",
        outputs: [
          { type: "slack.reply", max: 2 },
          { type: "telegram.reply", max: 1 },
        ],
      }),
    );
    if (initialValue === null) throw new Error("Expected an editable Automation");
    const save = vi.fn();
    render(
      <SingleAgentAutomationForm
        initialValue={initialValue}
        daemons={daemons}
        connections={[]}
        existingNames={[]}
        pending={false}
        save={save}
      />,
    );
    fireEvent.click(screen.getByText("Activate Automation changes"));
    expect(parseSingleAgentAutomationYaml(save.mock.calls[0]![0])?.outputs).toEqual(
      initialValue.outputs,
    );
    fireEvent.change(screen.getByLabelText("Maximum Slack replies"), {
      target: { value: "invalid" },
    });
    expect((screen.getByText("Activate Automation changes") as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByLabelText("Allow Slack Channel replies"));
    fireEvent.click(screen.getByText("Activate Automation changes"));
    expect(parseSingleAgentAutomationYaml(save.mock.calls[1]![0])?.outputs).toEqual([
      { type: "telegram.reply", max: 1 },
    ]);
  });
});

describe("Automation workspace navigation", () => {
  it("opens an overview and retains the configuration draft across tabs", () => {
    page.enabled = true;
    const yaml = buildSingleAgentAutomationYaml({
      name: "triage",
      daemonId: "daemon",
      cwd: "/workspace",
      provider: "codex",
      events: [{ name: "channel.message" }],
      instruction: "Triage requests",
    });
    page.resources = {
      automations: {
        automations: [
          {
            id: "automation",
            name: "triage",
            enabled: true,
            format: "single_agent",
            activeRevisionId: "revision",
            yaml,
          },
        ],
      },
      connections: { connections: [] },
      daemons: { daemons },
      "channel-configuration": { accounts: [] },
      effective: { owner: true, grants: [] },
      revisions: { revisions: [] },
      activity: { activity: [] },
    };
    render(<AutomationSettings ChannelInputs={ChannelDraftAdapter} />);
    expect(screen.queryByText("Open")).toBeNull();
    fireEvent.click(screen.getByText("triage"));
    expect(screen.getByText("Workstation").textContent).toBe("Workstation");
    expect(screen.queryByRole("button", { name: "Activate Automation changes" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Configuration" }));
    expect(screen.queryByLabelText("Automation YAML")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit step" }));
    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "Keep this draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Runs" }));
    expect(screen.getByText("No runs yet.").textContent).toBe("No runs yet.");
    fireEvent.click(screen.getByRole("button", { name: "Configuration" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit step" }));
    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    expect((screen.getByLabelText("Prompt") as HTMLInputElement).value).toBe("Keep this draft");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("button", { name: "Channels" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Route draft"), {
      target: { value: "Keep route draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: "Configuration" }));
    expect((screen.getByLabelText("Route draft") as HTMLInputElement).value).toBe(
      "Keep route draft",
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to Automations" }));
    expect(screen.getByRole("button", { name: "New Automation" }).textContent).toBe(
      "New Automation",
    );
  });
});
