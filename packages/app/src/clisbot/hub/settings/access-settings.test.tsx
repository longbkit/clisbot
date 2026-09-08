// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessSettings, assignmentResourceOptions } from "./access-settings";

const adapters = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  remove: vi.fn(),
  confirm: vi.fn(),
  push: vi.fn(),
  params: { subjectKind: "member", subjectId: "membership" },
}));
vi.mock("../account-provider", () => ({
  useHubAccount: () => ({
    origin: "https://hub.example.test",
    signedIn: {
      account: { id: "owner" },
      organization: { id: "org" },
      capabilities: { manageResources: true },
    },
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
    onValueChange(value: boolean): void;
  }) {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => props.onValueChange(event.target.checked),
      [props],
    );
    return (
      <input
        aria-label="Use Fast mode"
        type="checkbox"
        checked={props.value}
        disabled={props.disabled}
        onChange={change}
      />
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
  createdAt: "now",
  updatedAt: "now",
};
const resources = {
  "access-assignments": { assignments: [assignment] },
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

beforeEach(() => {
  vi.stubGlobal("React", React);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  adapters.get
    .mockReset()
    .mockImplementation(async (resource: keyof typeof resources) => resources[resource]);
  adapters.post.mockReset().mockResolvedValue(assignment);
  adapters.remove.mockReset();
  adapters.confirm.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

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
    const [subject] = await screen.findAllByLabelText("Team, Member or Guest");
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

  it("keeps specific conversation access after clearing selection and parses multiple IDs before saving", async () => {
    const channelAssignment = {
      ...assignment,
      resourceKind: "channel_account",
      resourceId: "slack/support",
      privileges: ["channel.message.send"],
      constraints: {
        conversation: { kind: "specific", conversationIds: ["C1"] },
      },
    };
    adapters.get.mockImplementation(async (resource: keyof typeof resources) => {
      if (resource === "access-assignments") return { assignments: [channelAssignment] };
      if (resource === "access-catalog")
        return {
          privileges: channelAssignment.privileges,
          accessLevels: {
            channel_account: { use: channelAssignment.privileges },
          },
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
    fireEvent.change(screen.getByLabelText("Conversation IDs"), {
      target: { value: "" },
    });
    expect((screen.getByLabelText("Conversations") as HTMLSelectElement).value).toBe("specific");
    fireEvent.click(screen.getByRole("button", { name: "Save access" }));
    expect(adapters.confirm).not.toHaveBeenCalled();
    expect(adapters.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Conversation IDs"), {
      target: { value: " C1, C2\nC3\nC2 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save access" }));
    await waitFor(() => expect(adapters.post).toHaveBeenCalledTimes(1));
    expect(adapters.post.mock.calls[0]?.[1]).toMatchObject({
      resourceKind: "channel_account",
      resourceId: "slack/support",
      constraints: {
        conversation: { kind: "specific", conversationIds: ["C1", "C2", "C3"] },
      },
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

  it("saves a Project edit atomically with the existing parent Host grant and grouped Agent constraints", async () => {
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
    adapters.get.mockImplementation(async (resource: keyof typeof resources) => {
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
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Save access" }));
    await waitFor(() => expect(adapters.post).toHaveBeenCalledTimes(1));
    expect(adapters.post.mock.calls[0]?.slice(0, 2)).toEqual([
      "access-assignments/batch",
      {
        assignments: [
          {
            subjectKind: "member",
            subjectId: "membership",
            resourceKind: "daemon",
            resourceId: "host",
            privileges: parentAssignment.privileges,
            constraints: parentAssignment.constraints,
          },
          {
            subjectKind: "member",
            subjectId: "membership",
            resourceKind: "project",
            resourceId: "project",
            privileges: projectAssignment.privileges,
            constraints,
          },
        ],
      },
    ]);
    expect(adapters.remove).not.toHaveBeenCalled();
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
