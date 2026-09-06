import { describe, expect, it, vi } from "vitest";
import type { HubApiClient } from "./api-client";
import {
  saveAutomationWithInputs,
  type AutomationInputSaveProgress,
} from "./automation-input-save";
import type { AutomationChannelDraft } from "./settings/automation-input-draft";
const yaml = "name: support\nenabled: true\n";
const draft: AutomationChannelDraft = {
  expectedRevisionId: "channels-1",
  accounts: [
    {
      channel: "slack",
      accountId: "support",
      routes: [{ workflow: "support" }, { agent: "existing" }],
    },
  ],
  resource: {},
  policy: {},
  grants: [],
};
// Inject API failures to exercise the actual resume sequence.
function transport(failPath?: string) {
  let fail = Boolean(failPath);
  const post = vi.fn(async (path: string, body: unknown): Promise<unknown> => {
    if (path === "automations")
      return {
        id: "automation",
        activeRevisionId: "revision-1",
        name: "support",
        enabled: true,
        yaml: (body as { yaml: string }).yaml,
      };
    return {};
  });
  const put = vi.fn(async (path: string, body: unknown) => {
    if (path === failPath && fail) {
      fail = false;
      throw new Error("revision conflict");
    }
    if (path === "channel-configuration") return { revision: { id: "channels-2" } };
    return {
      id: "automation",
      activeRevisionId: "revision-2",
      name: "support",
      enabled: true,
      yaml: (body as { yaml: string }).yaml,
    };
  });
  return { api: { post, put } as unknown as HubApiClient, post, put };
}
describe("save Automation with Channel inputs", () => {
  it("preserves neighboring direct Agent Routes", async () => {
    const { api, post, put } = transport();
    const saved = await saveAutomationWithInputs(api, yaml, draft, {});
    expect(saved.id).toBe("automation");
    expect(put.mock.calls[0]?.slice(0, 2)).toEqual([
      "channel-configuration",
      {
        expectedRevisionId: "channels-1",
        accounts: draft.accounts,
        resource: {},
        policy: {},
      },
    ]);
    expect(post.mock.calls.map(([path]) => path)).toEqual([
      "automations/validate",
      "automations",
      "channel-configuration/validate",
    ]);
  });
  it("reports partial success and retries without creating a duplicate Automation", async () => {
    const { api, post } = transport("channel-configuration");
    const progress: AutomationInputSaveProgress = {};
    await expect(saveAutomationWithInputs(api, yaml, draft, progress)).rejects.toThrow(
      "The Automation is saved and active, but input setup is incomplete",
    );
    await saveAutomationWithInputs(api, yaml, draft, progress);
    expect(post.mock.calls.filter(([path]) => path === "automations")).toHaveLength(1);
    expect(progress.channelRevisionId).toBe("channels-2");
  });
  it("rejects inactive targets before writing", async () => {
    const { api, post, put } = transport();
    await expect(
      saveAutomationWithInputs(api, "name: support\nenabled: false\n", draft, {}),
    ).rejects.toThrow("require an active Automation");
    expect(post).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
  it("retries access grants without rewriting saved Routes", async () => {
    const { api, post, put } = transport();
    const basePost = post.getMockImplementation()!;
    let fail = true;
    post.mockImplementation(async (path, body) => {
      if (path === "access-assignments/batch" && fail) {
        fail = false;
        throw new Error("access denied");
      }
      return basePost(path, body);
    });
    const progress: AutomationInputSaveProgress = {};
    const shared = {
      ...draft,
      grants: [
        {
          channel: "slack",
          accountId: "support",
          teamIds: ["team"],
          conversation: { kind: "public_channels" as const },
        },
      ],
    };
    await expect(saveAutomationWithInputs(api, yaml, shared, progress)).rejects.toThrow(
      "Channel access could not be saved",
    );
    await saveAutomationWithInputs(api, yaml, shared, progress);
    expect(put.mock.calls.filter(([path]) => path === "channel-configuration")).toHaveLength(1);
  });
});
