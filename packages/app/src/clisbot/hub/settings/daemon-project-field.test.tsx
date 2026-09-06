// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectSummary } from "@/utils/projects";
import { DaemonProjectField } from "./daemon-project-field";

const fixtures = vi.hoisted(() => ({
  projects: [] as ProjectSummary[],
  host: {
    connectionStatus: "online",
    agentDirectoryStatus: "ready",
    agentDirectoryError: null,
  } as Record<string, unknown> | null,
  refresh: vi.fn(),
}));
vi.mock("@/hooks/use-projects", () => ({
  useProjects: () => ({ projects: fixtures.projects, refetch: fixtures.refresh }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeSnapshot: () => fixtures.host,
  isHostRuntimeDirectoryLoading: (host: Record<string, unknown> | null) =>
    host?.agentDirectoryStatus === "initial_loading",
}));
vi.mock("@/data/query", () => ({
  useFetchQuery: () => ({
    data: {
      projects: [
        { id: "catalog-a", projectId: "a", name: "Brain", available: true },
        { id: "catalog-b", projectId: "b", name: "App", available: true },
      ],
    },
    error: null,
    isPending: false,
  }),
}));
vi.mock("../account-provider", () => ({
  useHubAccount: () => ({
    origin: "https://hub.test",
    signedIn: { account: { id: "owner" }, organization: { id: "org" } },
  }),
}));
vi.mock("@/styles/settings", () => ({ settingsStyles: {} }));
vi.mock("@/components/ui/select-field", () => ({
  SelectField: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string | null;
    options: { value: string; label: string }[];
    onChange(value: string): void;
  }) => {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value),
      [onChange],
    );
    return (
      <select aria-label={label} value={value ?? ""} onChange={change}>
        <option value="">Choose a Project</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  },
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    value,
    onValueChange,
    accessibilityLabel,
  }: {
    value: boolean;
    onValueChange(value: boolean): void;
    accessibilityLabel: string;
  }) => {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => onValueChange(event.target.checked),
      [onValueChange],
    );
    return (
      <input type="checkbox" aria-label={accessibilityLabel} checked={value} onChange={change} />
    );
  },
}));
vi.mock("@/components/ui/form-field", () => ({
  Field: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FormTextInput: ({
    initialValue,
    onChangeText,
  }: {
    initialValue: string;
    onChangeText(value: string): void;
  }) => {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => onChangeText(event.target.value),
      [onChangeText],
    );
    return <input aria-label="Working directory" defaultValue={initialValue} onChange={change} />;
  },
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress(): void;
    disabled: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));

function project(projectId: string, serverId: string, repoRoot: string): ProjectSummary {
  return {
    viewKey: `${serverId}:${projectId}`,
    projectName: projectId,
    totalWorkspaceCount: 0,
    hostCount: 1,
    onlineHostCount: 1,
    hosts: [
      {
        serverId,
        projectId,
        repoRoot,
        serverName: serverId,
        projectName: projectId,
        projectCustomName: null,
        isOnline: true,
        workspaceCount: 0,
        workspaces: [],
      },
    ],
  };
}
const props = { daemonId: "daemon", serverId: "sandbox", value: "a", cwd: "", disabled: false };
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.clearAllMocks();
  fixtures.projects = [
    project("a", "mac", "/wrong-host/brain"),
    project("a", "sandbox", "/srv/brain"),
    project("b", "sandbox", "/srv/app"),
  ];
  fixtures.host = {
    connectionStatus: "online",
    agentDirectoryStatus: "ready",
    agentDirectoryError: null,
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("uses the selected Host's Project root without asking for a directory", async () => {
  const changed = vi.fn();
  render(<DaemonProjectField {...props} onChange={vi.fn()} onCwdChange={changed} />);
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith("/srv/brain"));
  expect(screen.getByText("/srv/brain")).toBeTruthy();
  expect(screen.queryByLabelText("Working directory")).toBeNull();
});

it("keeps a saved custom directory through refresh and resets it when Project changes", async () => {
  const changed = vi.fn();
  const selected = vi.fn();
  const view = render(
    <DaemonProjectField
      {...props}
      cwd="/srv/brain/notes"
      onChange={selected}
      onCwdChange={changed}
    />,
  );
  expect((screen.getByLabelText("Working directory") as HTMLInputElement).value).toBe(
    "/srv/brain/notes",
  );
  fireEvent.change(screen.getByLabelText("Working directory"), {
    target: { value: "/srv/brain/docs" },
  });
  fixtures.projects = [...fixtures.projects];
  view.rerender(
    <DaemonProjectField
      {...props}
      cwd="/srv/brain/docs"
      onChange={selected}
      onCwdChange={changed}
    />,
  );
  expect((screen.getByLabelText("Working directory") as HTMLInputElement).value).toBe(
    "/srv/brain/docs",
  );
  fireEvent.change(screen.getByLabelText("Project"), { target: { value: "b" } });
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith("/srv/app"));
  expect(selected).toHaveBeenCalledWith("b");
  expect(screen.queryByLabelText("Working directory")).toBeNull();
});

it("waits for Project data without guessing and exposes recovery when the Host is missing", async () => {
  const changed = vi.fn();
  fixtures.projects = [];
  fixtures.host = { connectionStatus: "online", agentDirectoryStatus: "initial_loading" };
  const view = render(<DaemonProjectField {...props} onChange={vi.fn()} onCwdChange={changed} />);
  expect(screen.getByText("Loading Project folder…")).toBeTruthy();
  expect(changed).toHaveBeenLastCalledWith("");
  fixtures.projects = [project("a", "sandbox", "/srv/brain")];
  fixtures.host = { connectionStatus: "online", agentDirectoryStatus: "ready" };
  view.rerender(<DaemonProjectField {...props} onChange={vi.fn()} onCwdChange={changed} />);
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith("/srv/brain"));
  fixtures.host = null;
  fixtures.projects = [];
  view.rerender(
    <DaemonProjectField
      {...props}
      daemonId="other"
      serverId={null}
      onChange={vi.fn()}
      onCwdChange={changed}
    />,
  );
  expect(screen.getByText("Connect this Host to load the Project folder.")).toBeTruthy();
  expect(changed).toHaveBeenLastCalledWith("");
  fireEvent.click(screen.getByText("Refresh Projects"));
  expect(fixtures.refresh).toHaveBeenCalledOnce();
});

it("returns to the Project root when custom directory is turned off", async () => {
  const changed = vi.fn();
  render(
    <DaemonProjectField
      {...props}
      cwd="/srv/brain/notes"
      onChange={vi.fn()}
      onCwdChange={changed}
    />,
  );
  fireEvent.click(screen.getByLabelText("Use a custom working directory"));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith("/srv/brain"));
  expect(screen.queryByLabelText("Working directory")).toBeNull();
});
