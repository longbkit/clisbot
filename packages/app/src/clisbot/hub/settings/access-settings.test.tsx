// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessSettings } from "./access-settings";
import { assignmentResourceOptions } from "./access-catalog";

const adapters = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  remove: vi.fn(),
  confirm: vi.fn(),
  push: vi.fn(),
  params: { subjectKind: "member", subjectId: "membership" },
  session: {
    account: { id: "owner" },
    organization: { id: "org" },
    capabilities: { manageResources: true },
  },
}));
vi.mock("../account-provider", () => ({
  useHubAccount: () => ({
    origin: "https://hub.example.test",
    signedIn: adapters.session,
    api: () => ({
      get: adapters.get,
      post: adapters.post,
      delete: adapters.remove,
    }),
  }),
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => adapters.params,
  useRouter: () => ({ push: adapters.push }),
}));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: adapters.confirm }));
vi.mock("@/components/ui/switch", () => ({
  Switch: function TestSwitch(props: {
    value: boolean;
    disabled?: boolean;
    accessibilityLabel?: string;
    onValueChange(value: boolean): void;
  }) {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => props.onValueChange(event.target.checked),
      [props],
    );
    return (
      <input
        aria-label={props.accessibilityLabel}
        type="checkbox"
        checked={props.value}
        disabled={props.disabled}
        onChange={change}
      />
    );
  },
}));
// The real field opens a Combobox, whose module cannot load under this runner.
vi.mock("./multi-select-field", () => ({
  selectionLabel: () => null,
  MultiSelectField: function TestMultiSelectField(props: {
    label: string;
    disabled?: boolean;
    options: { id: string; value: string; label: string }[];
    value: "*" | readonly string[] | null;
    onChange(value: "*" | readonly string[]): void;
  }) {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLSelectElement>) =>
        props.onChange([...event.target.selectedOptions].map((option) => option.value)),
      [props],
    );
    return (
      <select
        multiple
        aria-label={props.label}
        disabled={props.disabled}
        value={props.value === "*" || props.value === null ? [] : [...props.value]}
        onChange={change}
      >
        {props.options.map((option) => (
          <option key={option.id} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  },
}));
vi.mock("./conversation-picker-field", () => ({
  ConversationSelectionFields: function TestConversationSelection(props: {
    value: string;
    disabled?: boolean;
    onChange(value: string): void;
  }) {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLTextAreaElement>) => props.onChange(event.target.value),
      [props],
    );
    return (
      <textarea
        aria-label="Conversation IDs"
        value={props.value}
        disabled={props.disabled}
        onChange={change}
      />
    );
  },
}));
// Adapt platform input controls; the Access form, buttons, state and queries remain real.
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: (props: {
    visible: boolean;
    header: { title: string };
    children: React.ReactNode;
  }) =>
    props.visible ? (
      <div role="dialog" aria-label={props.header.title}>
        {props.children}
      </div>
    ) : null,
}));
// The row's … menu renders its items inline, so a test presses Remove directly.
vi.mock("./team/row-actions-menu", () => ({
  RowActionsMenu: (props: {
    actions: readonly { label: string; onSelect(): void; disabled?: boolean }[];
    disabled: boolean;
  }) => (
    <>
      {props.actions.map((action) => (
        <button
          key={action.label}
          type="button"
          disabled={props.disabled || action.disabled}
          onClick={action.onSelect}
        >
          {action.label}
        </button>
      ))}
    </>
  ),
}));
vi.mock("@/components/ui/select-field", () => ({
  SelectField: function TestSelectField(props: {
    label: string;
    value: string | null;
    disabled?: boolean;
    options: { id: string; value: string; label: string }[];
    onChange(value: string): void;
  }) {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLSelectElement>) => props.onChange(event.target.value),
      [props],
    );
    return (
      <select
        aria-label={props.label}
        disabled={props.disabled}
        value={props.value ?? ""}
        onChange={change}
      >
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

const assignment = {
  id: "assignment",
  organizationId: "org",
  subjectKind: "member",
  subjectId: "membership",
  resourceKind: "daemon",
  resourceId: "host",
  privileges: ["daemon.connect", "agent.fast.use", "custom.future"],
  constraints: { futureConstraint: { preserve: true } },
  createdByUserId: "user",
  createdAt: "now",
  updatedAt: "now",
};
const resources = {
  "access-assignments": { assignments: [assignment] },
  "access-assignments/effective": { owner: false, grants: [] },
  "access-events": { events: [] },
  "access-catalog": {
    privileges: ["daemon.connect"],
    accessLevels: { daemon: { connect: ["daemon.connect"] } },
    resources: [
      {
        kind: "daemon",
        id: "host",
        name: "Workstation",
        parent: null,
        available: true,
      },
    ],
  },
  members: {
    members: [
      {
        id: "membership",
        userId: "user",
        name: "Member One",
        email: "member@example.test",
        role: "member",
      },
    ],
  },
  teams: { teams: [] },
  "channel-configuration": { accounts: [] },
};
let queryClient: QueryClient;

type ResourceName = keyof typeof resources;

/** The app appends `?include=team` and `?limit=`; the fixtures are keyed by bare path. */
function resourceOf(resource: string): ResourceName {
  const [name] = resource.split("?");
  return name as ResourceName;
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  adapters.session.capabilities.manageResources = true;
  adapters.get
    .mockReset()
    .mockImplementation(async (resource: string) => resources[resourceOf(resource)]);
  adapters.post.mockReset().mockResolvedValue(assignment);
  adapters.remove.mockReset();
  adapters.confirm.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

/** The grant form is a sheet the page's Grant access… button opens. */
async function openGrant() {
  fireEvent.click(await screen.findByRole("button", { name: "Grant access…" }));
}
function renderAccess() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AccessSettings />
    </QueryClientProvider>,
  );
}

describe("Access assignment editing", () => {
  it.each(["Save access", "Remove"])(
    "ignores a delayed %s confirmation after leaving Access",
    async (action) => {
      let confirm!: (value: boolean) => void;
      adapters.confirm.mockReturnValue(
        new Promise<boolean>((resolve) => {
          confirm = resolve;
        }),
      );
      const view = renderAccess();
      await screen.findByRole("button", { name: "Edit" });
      if (action === "Save access") fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      fireEvent.click(screen.getByRole("button", { name: action }));
      expect(adapters.confirm).toHaveBeenCalledTimes(1);
      view.unmount();
      await act(async () => confirm(true));
      expect(adapters.post).not.toHaveBeenCalled();
      expect(adapters.remove).not.toHaveBeenCalled();
    },
  );

  it("ignores a delayed grant confirmation after cancelling its editor while Access stays mounted", async () => {
    let confirm!: (value: boolean) => void;
    adapters.confirm.mockReturnValue(
      new Promise<boolean>((resolve) => {
        confirm = resolve;
      }),
    );
    renderAccess();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save access" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => confirm(true));
    expect(adapters.post).not.toHaveBeenCalled();
  });

  it("recovers an initial query failure without showing an empty assignment state", async () => {
    adapters.get.mockRejectedValueOnce(new Error("Access unavailable"));
    renderAccess();
    await screen.findByText("Access unavailable");
    expect(
      screen.queryByText("No assignments for this selection. The owner still has full access."),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry Access" }));
    await screen.findByRole("button", { name: "Edit" });
    expect(screen.queryByText("Access unavailable")).toBeNull();
  });

  it("authors a Guest grant using the organization-scoped Guest identity", async () => {
    renderAccess();
    await openGrant();
    // The first is the page's filter; the sheet's own field comes after it.
    const subject = (await screen.findAllByLabelText("Team, Member or Guest")).at(-1);
    fireEvent.change(subject!, { target: { value: "guest\0guest" } });
    fireEvent.change(screen.getByLabelText("Resource"), { target: { value: "daemon\0host" } });
    fireEvent.change(screen.getByLabelText("Access level"), { target: { value: "connect" } });
    fireEvent.click(screen.getByRole("button", { name: "Grant access" }));
    await waitFor(() => expect(adapters.post).toHaveBeenCalled());
    expect(adapters.post.mock.calls[0]?.[1]).toMatchObject({
      subjectKind: "guest",
      subjectId: "guest",
    });
  });

  it("opens the linked Member, locks identity and updates using the canonical upsert without deleting", async () => {
    renderAccess();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const subjectFields = screen.getAllByLabelText("Team, Member or Guest") as HTMLSelectElement[];
    expect(subjectFields.every((field) => field.value === "member\0membership")).toBe(true);
    expect(subjectFields.at(-1)?.disabled).toBe(true);
    expect((screen.getByLabelText("Resource") as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save access" }));
    await waitFor(() => expect(adapters.post).toHaveBeenCalledTimes(1));
    expect(adapters.post.mock.calls[0]?.slice(0, 2)).toEqual([
      "access-assignments",
      {
        subjectKind: "member",
        subjectId: "membership",
        resourceKind: "daemon",
        resourceId: "host",
        privileges: assignment.privileges,
        constraints: assignment.constraints,
      },
    ]);
    expect(adapters.remove).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save access" })).toBeNull());
  });

  it("grants Connection Admin with no Conversations field and saves it for every conversation", async () => {
    const channelAssignment = {
      ...assignment,
      resourceKind: "channel_account",
      resourceId: "slack/support",
      privileges: ["channel.manage"],
      constraints: { conversation: { kind: "all" } },
    };
    adapters.get.mockImplementation(async (path: string) => {
      const resource = resourceOf(path);
      if (resource === "access-assignments") return { assignments: [channelAssignment] };
      if (resource === "access-catalog")
        return {
          privileges: channelAssignment.privileges,
          accessLevels: { channel_account: { manage: ["channel.manage"] } },
          resources: [
            {
              kind: "channel_account",
              id: "slack/support",
              name: "Support",
              parent: null,
              available: true,
            },
          ],
        };
      return resources[resource];
    });
    renderAccess();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    // Who may talk to the bot is the Route's audience rules, never a grant.
    expect(screen.queryByLabelText("Conversations")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save access" }));
    await waitFor(() => expect(adapters.post).toHaveBeenCalledTimes(1));
    expect(adapters.post.mock.calls[0]?.[1]).toMatchObject({
      resourceKind: "channel_account",
      resourceId: "slack/support",
      privileges: ["channel.manage"],
      constraints: { conversation: { kind: "all" } },
    });
  });

  it("retains edits after a failed save and allows retry without losing constraints", async () => {
    adapters.post.mockRejectedValueOnce(new Error("Access update failed"));
    renderAccess();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Access level"), {
      target: { value: "connect" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save access" }));
    await screen.findByText("Access update failed");
    expect((screen.getByLabelText("Access level") as HTMLSelectElement).value).toBe("connect");
    fireEvent.click(screen.getByRole("button", { name: "Save access" }));
    await waitFor(() => expect(adapters.post).toHaveBeenCalledTimes(2));
    expect(adapters.post.mock.calls[1]?.[1]).toEqual({
      subjectKind: "member",
      subjectId: "membership",
      resourceKind: "daemon",
      resourceId: "host",
      privileges: ["daemon.connect"],
      constraints: assignment.constraints,
    });
    expect(adapters.remove).not.toHaveBeenCalled();
  });

  it("saves a Project edit alone when the parent Host already holds Connect, keeping grouped Agent constraints", async () => {
    const constraints = {
      agentConfigurations: [
        { providerId: "codex", modelIds: ["m1", "m2"], thinkingOptionIds: "*" },
      ],
    };
    const projectAssignment = {
      ...assignment,
      id: "project-assignment",
      resourceKind: "project",
      resourceId: "project",
      privileges: ["project.use", "agent.create", "agent.fast.use"],
      constraints,
    };
    const parentAssignment = {
      ...assignment,
      privileges: ["daemon.connect", "daemon.manage"],
    };
    const models = ["m1", "m2"].map((id) => ({
      id,
      label: id,
      thinkingOptions: [],
    }));
    adapters.get.mockImplementation(async (path: string) => {
      const resource = resourceOf(path);
      if (resource === "access-assignments")
        return { assignments: [projectAssignment, parentAssignment] };
      if (resource === "access-catalog")
        return {
          ...resources[resource],
          resources: [
            ...resources[resource].resources,
            {
              kind: "project",
              id: "project",
              name: "Project",
              available: true,
              parent: { kind: "daemon", id: "host" },
              agentConfigurationCatalog: {
                providers: [
                  {
                    id: "codex",
                    label: "Codex",
                    models,
                  },
                ],
              },
            },
          ],
        };
      return resources[resource];
    });
    renderAccess();
    // Rows read Host first, then its Project: edit the Project's.
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" })).at(-1)!);
    fireEvent.click(screen.getByRole("button", { name: "Save access" }));
    await waitFor(() => expect(adapters.post).toHaveBeenCalledTimes(1));
    // The Host row is left alone: a Project sharer who cannot share the Host must not rewrite it.
    expect(adapters.post.mock.calls[0]?.slice(0, 2)).toEqual([
      "access-assignments",
      {
        subjectKind: "member",
        subjectId: "membership",
        resourceKind: "project",
        resourceId: "project",
        privileges: projectAssignment.privileges,
        constraints,
      },
    ]);
    expect(adapters.remove).not.toHaveBeenCalled();
  });

  it("reads the catalog, assignments, and effective access with Team resources included", async () => {
    renderAccess();
    await screen.findByRole("button", { name: "Edit" });
    const paths = adapters.get.mock.calls.map(([path]) => path as string);
    expect(paths).toEqual(
      expect.arrayContaining([
        "access-catalog?include=team",
        "access-assignments?include=team",
        "access-assignments/effective?include=team",
      ]),
    );
  });

  it("shows who made each grant, falling back to Hub for rows without an author", async () => {
    adapters.get.mockImplementation(async (path: string) => {
      const resource = resourceOf(path);
      if (resource === "access-assignments")
        return {
          assignments: [
            assignment,
            // Different privileges keep it out of the first row's group.
            { ...assignment, id: "by-hub", privileges: ["daemon.connect"], createdByUserId: null },
          ],
        };
      return resources[resource];
    });
    renderAccess();
    // Granted by is its own column: the author's name, or Hub.
    expect(await screen.findByText("Hub")).toBeTruthy();
    expect(screen.getAllByText("Member One").length).toBeGreaterThan(0);
  });
});

describe("Access granted to more than one Resource at a time", () => {
  const catalog = {
    providers: [
      {
        id: "codex",
        label: "Codex",
        models: [
          { id: "m1", label: "Model One", thinkingOptions: [{ id: "t1", label: "Low" }] },
          { id: "m2", label: "Model Two", thinkingOptions: [] },
        ],
      },
    ],
  };

  function mockCatalog(
    extraResources: unknown[],
    accessLevels: Record<string, unknown>,
    hostCatalog?: unknown,
    existingAssignments: unknown[] = [],
  ) {
    adapters.get.mockImplementation(async (path: string) => {
      const resource = resourceOf(path);
      if (resource === "access-assignments") return { assignments: existingAssignments };
      if (resource === "access-catalog")
        return {
          ...resources[resource],
          accessLevels: { ...resources[resource].accessLevels, ...accessLevels },
          resources: [
            // A Host publishes one Provider catalog for all of its Projects.
            ...resources[resource].resources.map((entry) =>
              hostCatalog === undefined
                ? entry
                : { ...entry, agentConfigurationCatalog: hostCatalog },
            ),
            ...extraResources,
          ],
        };
      return resources[resource];
    });
  }

  function chooseMany(label: string, values: string[]) {
    const select = screen.getByLabelText(label) as HTMLSelectElement;
    for (const option of select.options) option.selected = values.includes(option.value);
    fireEvent.change(select);
  }

  it("writes one assignment per selected Project plus the parent Host in a single batch", async () => {
    const existingOnB = {
      ...assignment,
      id: "existing-b",
      resourceKind: "project",
      resourceId: "project-b",
      privileges: ["project.use", "agent.create"],
      constraints: {
        agentConfigurations: [{ providerId: "claude", modelIds: "*", thinkingOptionIds: "*" }],
      },
    };
    mockCatalog(
      ["a", "b"].map((id) => ({
        kind: "project",
        id: `project-${id}`,
        name: `Project ${id.toUpperCase()}`,
        available: true,
        parent: { kind: "daemon", id: "host" },
        agentConfigurationCatalog: catalog,
      })),
      { project: { developer: ["project.use", "agent.create"] } },
      undefined,
      [existingOnB],
    );
    renderAccess();
    await openGrant();
    fireEvent.change(await screen.findByLabelText("Resource"), {
      target: { value: "project\u0000project-a" },
    });
    chooseMany("Also apply to", ["project\u0000project-b"]);
    fireEvent.change(screen.getByLabelText("Access level"), { target: { value: "developer" } });
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "codex" } });
    chooseMany("Models", ["m1", "m2"]);
    fireEvent.click(screen.getByRole("button", { name: "Grant access" }));
    await waitFor(() => expect(adapters.post).toHaveBeenCalledTimes(1));
    // The batch is an upsert: Project B loses its Claude grant, so the operator is told.
    const { message } = adapters.confirm.mock.calls[0]![0] as { message: string };
    expect(message).toContain("Project A, Project B");
    expect(message).toContain(
      "Replaces existing access, including its Agent choices, on: Project B",
    );
    const [path, body] = adapters.post.mock.calls[0]!.slice(0, 2) as [
      string,
      { assignments: unknown[] },
    ];
    expect(path).toBe("access-assignments/batch");
    expect(body.assignments).toEqual([
      expect.objectContaining({ resourceKind: "daemon", resourceId: "host" }),
      expect.objectContaining({
        resourceKind: "project",
        resourceId: "project-a",
        // One row names both Models; it is not split into one grant per Model.
        constraints: {
          agentConfigurations: [
            { providerId: "codex", modelIds: ["m1", "m2"], thinkingOptionIds: "*" },
          ],
        },
      }),
      expect.objectContaining({ resourceKind: "project", resourceId: "project-b" }),
    ]);
  });

  it("edits a Host grant in place, keeping its Agent choices and Fast mode", async () => {
    const hostGrant = {
      ...assignment,
      privileges: ["daemon.connect", "project.use", "agent.create", "agent.fast.use"],
      constraints: {
        agentConfigurations: [
          { providerId: "codex", modelIds: ["m1", "m2"], thinkingOptionIds: "*" },
        ],
      },
    };
    mockCatalog(
      [],
      { daemon: { developer: ["daemon.connect", "project.use", "agent.create"] } },
      catalog,
      [hostGrant],
    );
    renderAccess();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    // A finished grant opens collapsed; the Host row alone is written back.
    expect(screen.queryByLabelText("Models")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save access" }));
    await waitFor(() => expect(adapters.post).toHaveBeenCalledTimes(1));
    expect(adapters.post.mock.calls[0]?.[1]).toEqual({
      subjectKind: "member",
      subjectId: "membership",
      resourceKind: "daemon",
      resourceId: "host",
      privileges: hostGrant.privileges,
      constraints: hostGrant.constraints,
    });
  });

  it("tells the operator that Guest means every unlinked sender before a Host grant", async () => {
    mockCatalog([], { daemon: { connect: ["daemon.connect"] } });
    adapters.confirm.mockResolvedValue(false);
    renderAccess();
    await openGrant();
    // The view filter above the form has the same label; the grant form is last.
    const subjectFields = await screen.findAllByLabelText("Team, Member or Guest");
    fireEvent.change(subjectFields.at(-1)!, { target: { value: "guest\u0000guest" } });
    fireEvent.change(screen.getByLabelText("Resource"), { target: { value: "daemon\u0000host" } });
    fireEvent.change(screen.getByLabelText("Access level"), { target: { value: "connect" } });
    fireEvent.click(screen.getByRole("button", { name: "Grant access" }));
    await waitFor(() => expect(adapters.confirm).toHaveBeenCalledTimes(1));
    const { message } = adapters.confirm.mock.calls[0]![0] as { message: string };
    expect(message).toContain("Guest is every channel sender without a linked Member");
    expect(message).toContain("including Projects added later");
    expect(adapters.post).not.toHaveBeenCalled();
  });

  it("says what Full access reaches before granting it on a Host", async () => {
    mockCatalog(
      [],
      {
        daemon: {
          full_access: ["daemon.connect", "project.use", "agent.create", "workspace.manage"],
        },
      },
      catalog,
    );
    adapters.confirm.mockResolvedValue(false);
    renderAccess();
    await openGrant();
    fireEvent.change(await screen.findByLabelText("Resource"), {
      target: { value: "daemon\u0000host" },
    });
    fireEvent.change(screen.getByLabelText("Access level"), { target: { value: "full_access" } });
    // The consequences show under the picker, before anyone presses Grant.
    const summary = screen.getByTestId("access-level-summary");
    expect(summary.textContent).toContain("Create Projects in any folder on this Host");
    expect(summary.textContent).toContain("Before you grant");
    expect(summary.textContent).toContain("Any folder this machine can read can become a Project");
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "codex" } });
    chooseMany("Models", ["m1"]);
    fireEvent.click(screen.getByRole("button", { name: "Grant access" }));
    await waitFor(() => expect(adapters.confirm).toHaveBeenCalledTimes(1));
    const { message } = adapters.confirm.mock.calls[0]![0] as { message: string };
    expect(message).toContain("Create Projects in any folder on this Host");
    expect(message).toContain("including other people's");
    expect(adapters.post).not.toHaveBeenCalled();
  });

  it("names the level a saved grant equals instead of listing its privileges", async () => {
    mockCatalog(
      [],
      { daemon: { developer: ["daemon.connect", "project.use", "agent.create"] } },
      catalog,
      [
        {
          ...assignment,
          privileges: ["daemon.connect", "project.use", "agent.create", "agent.fast.use"],
        },
      ],
    );
    renderAccess();
    expect(await screen.findByText(/Developer \+ Fast mode/)).toBeTruthy();
  });

  it("offers Agent choices on a Host, where the grant reaches every Project", async () => {
    mockCatalog(
      [
        {
          kind: "project",
          id: "project-a",
          name: "Project A",
          available: true,
          parent: { kind: "daemon", id: "host" },
          agentConfigurationCatalog: catalog,
        },
      ],
      { daemon: { developer: ["daemon.connect", "project.use", "agent.create"] } },
      catalog,
    );
    renderAccess();
    await openGrant();
    fireEvent.change(await screen.findByLabelText("Resource"), {
      target: { value: "daemon\u0000host" },
    });
    fireEvent.change(screen.getByLabelText("Access level"), { target: { value: "developer" } });
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "codex" } });
    chooseMany("Models", ["m1"]);
    fireEvent.click(screen.getByRole("button", { name: "Grant access" }));
    await waitFor(() => expect(adapters.post).toHaveBeenCalledTimes(1));
    expect(adapters.post.mock.calls[0]?.[1]).toMatchObject({
      resourceKind: "daemon",
      resourceId: "host",
      constraints: {
        agentConfigurations: [{ providerId: "codex", modelIds: ["m1"], thinkingOptionIds: "*" }],
      },
    });
  });
});

describe("Access picker catalog", () => {
  it("shows project parent names to distinguish duplicate names and availability", () => {
    const catalogResources = [
      {
        kind: "daemon" as const,
        id: "a",
        name: "Sandbox",
        parent: null,
        available: true,
      },
      {
        kind: "daemon" as const,
        id: "b",
        name: "Production",
        parent: null,
        available: true,
      },
      {
        kind: "project" as const,
        id: "p1",
        name: "Website",
        parent: { kind: "daemon" as const, id: "a" },
        available: true,
      },
      {
        kind: "project" as const,
        id: "p2",
        name: "Website",
        parent: { kind: "daemon" as const, id: "b" },
        available: false,
      },
    ];
    const options = assignmentResourceOptions(catalogResources, false);
    expect(
      options.filter((option) => option.group === "Projects").map((option) => option.description),
    ).toEqual(["Sandbox", "Production · Unavailable"]);
    expect(
      assignmentResourceOptions(catalogResources, true).map((option) => option.value),
    ).not.toContain("project\0p2");
  });
});

describe("Can share and grant-at-most-what-you-hold", () => {
  const OFFICE_WORKER = ["project.use", "agent.interact", "agent.create", "approval.file"];
  const DEVELOPER = [...OFFICE_WORKER, "terminal.use"];
  const levels = {
    daemon: {
      connect: ["daemon.connect"],
      office_worker: ["daemon.connect", ...OFFICE_WORKER],
      developer: ["daemon.connect", ...DEVELOPER],
      full_access: ["daemon.connect", ...DEVELOPER, "workspace.manage", "hub.access.manage"],
      administrator: ["daemon.connect", "daemon.manage", "hub.access.manage"],
    },
    project: { office_worker: OFFICE_WORKER, developer: DEVELOPER },
    team: { admin: ["hub.access.manage"] },
  };
  const catalog = {
    providers: [
      { id: "codex", label: "Codex", models: [{ id: "m1", label: "M1", thinkingOptions: [] }] },
    ],
  };
  const project = {
    kind: "project",
    id: "project",
    name: "Project",
    available: true,
    parent: { kind: "daemon", id: "host" },
    agentConfigurationCatalog: catalog,
  };
  const team = { kind: "team", id: "team", name: "QC", parent: null, available: true };

  function mockHub(input: {
    assignments?: unknown[];
    effective?: unknown;
    resources?: unknown[];
    teams?: unknown[];
  }) {
    adapters.get.mockImplementation(async (path: string) => {
      const resource = resourceOf(path);
      if (resource === "access-assignments") return { assignments: input.assignments ?? [] };
      if (resource === "teams") return { teams: input.teams ?? [] };
      if (resource === "access-assignments/effective")
        return input.effective ?? { owner: false, grants: [] };
      if (resource === "access-catalog")
        return {
          privileges: [],
          accessLevels: levels,
          resources: [
            { ...resources["access-catalog"].resources[0], agentConfigurationCatalog: catalog },
            ...(input.resources ?? [project, team]),
          ],
        };
      return resources[resource];
    });
  }

  function chooseModels(values: string[]) {
    const select = screen.getByLabelText("Models") as HTMLSelectElement;
    for (const option of select.options) option.selected = values.includes(option.value);
    fireEvent.change(select);
  }

  it("locks Can share on for Full access, hides it for Connect, and offers it for Developer", async () => {
    mockHub({});
    renderAccess();
    await openGrant();
    fireEvent.change(await screen.findByLabelText("Resource"), {
      target: { value: "daemon\0host" },
    });
    fireEvent.change(screen.getByLabelText("Access level"), { target: { value: "connect" } });
    expect(screen.queryByLabelText("Can share")).toBeNull();
    fireEvent.change(screen.getByLabelText("Access level"), { target: { value: "full_access" } });
    const locked = screen.getByLabelText("Can share") as HTMLInputElement;
    expect(locked.checked).toBe(true);
    expect(locked.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Access level"), { target: { value: "developer" } });
    const optional = screen.getByLabelText("Can share") as HTMLInputElement;
    expect(optional.checked).toBe(false);
    expect(optional.disabled).toBe(false);
    expect(
      screen.getByText("Add, change, or remove people on this Host, up to their own level."),
    ).toBeTruthy();
  });

  it("writes Can share into a Developer grant when switched on", async () => {
    mockHub({});
    renderAccess();
    await openGrant();
    fireEvent.change(await screen.findByLabelText("Resource"), {
      target: { value: "daemon\0host" },
    });
    fireEvent.change(screen.getByLabelText("Access level"), { target: { value: "developer" } });
    fireEvent.click(screen.getByLabelText("Can share"));
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "codex" } });
    chooseModels(["m1"]);
    fireEvent.click(screen.getByRole("button", { name: "Grant access" }));
    await waitFor(() => expect(adapters.post).toHaveBeenCalledTimes(1));
    expect(adapters.post.mock.calls[0]?.[1]).toMatchObject({
      privileges: ["daemon.connect", ...DEVELOPER, "hub.access.manage"],
    });
  });

  it("asks before Administrator is selected and keeps the previous level on cancel", async () => {
    mockHub({});
    adapters.confirm.mockResolvedValue(false);
    renderAccess();
    await openGrant();
    fireEvent.change(await screen.findByLabelText("Resource"), {
      target: { value: "daemon\0host" },
    });
    fireEvent.change(screen.getByLabelText("Access level"), { target: { value: "developer" } });
    fireEvent.change(screen.getByLabelText("Access level"), { target: { value: "administrator" } });
    await waitFor(() => expect(adapters.confirm).toHaveBeenCalledTimes(1));
    const { message } = adapters.confirm.mock.calls[0]![0] as { message: string };
    expect(message).toContain("This person will control the daemon");
    expect(message).toContain("Organization Admins will be notified");
    expect((screen.getByLabelText("Access level") as HTMLSelectElement).value).toBe("developer");
    adapters.confirm.mockResolvedValue(true);
    fireEvent.change(screen.getByLabelText("Access level"), { target: { value: "administrator" } });
    await waitFor(() =>
      expect((screen.getByLabelText("Access level") as HTMLSelectElement).value).toBe(
        "administrator",
      ),
    );
  });

  it("offers a Team only the Admin level and words it as Admin", async () => {
    mockHub({});
    renderAccess();
    await openGrant();
    fireEvent.change(await screen.findByLabelText("Resource"), { target: { value: "team\0team" } });
    const level = screen.getByLabelText("Access level") as HTMLSelectElement;
    expect([...level.options].map((option) => option.textContent)).toEqual(["Choose", "Admin"]);
    expect(screen.queryByLabelText("Can share")).toBeNull();
  });

  it("limits a Member who can share to their own resources and level, and locks higher rows", async () => {
    adapters.session.capabilities.manageResources = false;
    const higher = {
      ...assignment,
      id: "higher",
      resourceKind: "project",
      resourceId: "project",
      privileges: DEVELOPER,
      createdByUserId: "user",
    };
    // Inherited through the Team, so both rows show under the same Member.
    const lower = {
      ...higher,
      id: "lower",
      privileges: OFFICE_WORKER,
      subjectKind: "team",
      subjectId: "team",
    };
    mockHub({
      assignments: [higher, lower],
      teams: [{ id: "team", name: "QC", userIds: ["user"], createdAt: "now", updatedAt: null }],
      effective: {
        owner: false,
        grants: [
          {
            assignmentId: "own",
            resource: project,
            privileges: [...OFFICE_WORKER, "hub.access.manage"],
            constraints: {},
            source: { kind: "direct" },
          },
        ],
      },
    });
    renderAccess();
    await openGrant();
    const resource = screen.getByLabelText("Resource") as HTMLSelectElement;
    expect([...resource.options].map((option) => option.value)).toEqual(["", "project\0project"]);
    fireEvent.change(resource, { target: { value: "project\0project" } });
    const level = screen.getByLabelText("Access level") as HTMLSelectElement;
    expect([...level.options].map((option) => option.value)).toEqual(["", "office_worker"]);
    expect(screen.getByText("Above your own level, not offered: Developer")).toBeTruthy();
    // The Developer row on the same Project is above the viewer: no Edit, no Remove.
    expect(screen.getAllByText("Above your level")).toHaveLength(1);
    // Opened on Member One: the Team grant shows under them, edited on the Team.
    expect(screen.getByText("via Team QC")).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: "Edit" })).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /^QC/u }));
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
  });

  it("shows the Hub's refusal inline when a grant exceeds the viewer", async () => {
    const { HubApiError } = await import("../api-client");
    mockHub({});
    adapters.post.mockRejectedValueOnce(
      new HubApiError(
        403,
        "access_exceeds_grantor",
        "You do not hold terminal.use on this resource.",
      ),
    );
    renderAccess();
    await openGrant();
    fireEvent.change(await screen.findByLabelText("Resource"), {
      target: { value: "daemon\0host" },
    });
    fireEvent.change(screen.getByLabelText("Access level"), { target: { value: "connect" } });
    fireEvent.click(screen.getByRole("button", { name: "Grant access" }));
    await screen.findByText("Above what you can grant");
    expect(screen.getByText("You do not hold terminal.use on this resource.")).toBeTruthy();
  });

  it("opens the Access page for a Member with Team Admin only, and not for one with nothing", async () => {
    adapters.session.capabilities.manageResources = false;
    mockHub({
      effective: {
        owner: false,
        grants: [
          {
            assignmentId: "team-admin",
            resource: team,
            privileges: ["hub.access.manage"],
            constraints: {},
            source: { kind: "direct" },
          },
        ],
      },
    });
    const view = renderAccess();
    await screen.findByRole("button", { name: "Grant access…" });
    view.unmount();
    mockHub({});
    renderAccess();
    await screen.findByText("No resource access has been granted to you yet.");
    expect(screen.queryByRole("button", { name: "Grant access…" })).toBeNull();
  });
});
