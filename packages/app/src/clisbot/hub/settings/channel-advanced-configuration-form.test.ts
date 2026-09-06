import { expect, it, vi } from "vitest";
import { formatChannelConfigurationYaml } from "../channel-configuration";
import { openChannelYamlForm } from "./channel-advanced-configuration-form";

const candidate = {
  resource: { project: { host: "host-1", projectId: "project-1", cwd: "/workspace" } },
  policy: { enabled: true, limits: { messagesPerMinute: 10 } },
  accounts: [
    { channel: "slack", accountId: "one", routes: [] },
    { channel: "telegram", accountId: "two", routes: [] },
  ],
};
const source = formatChannelConfigurationYaml(candidate);
const snapshot = { source, revisionId: "revision-1" };

it("passes all three roots unchanged and activation remains a separate canonical operation", async () => {
  const form = openChannelYamlForm(snapshot);
  form.change(`${source}\n# reviewed`);
  const validate = vi.fn().mockResolvedValue(undefined);
  const save = vi.fn().mockResolvedValue(true);
  await form.validate(validate);
  expect(validate).toHaveBeenCalledWith(candidate);
  expect(save).not.toHaveBeenCalled();
  await form.activate(save);
  expect(save).toHaveBeenCalledWith(candidate);
  expect(form.getState()).toMatchObject({ dirty: false, message: "Configuration activated." });
});

it("invalidates validation after edits and ignores late success for an older draft", async () => {
  const form = openChannelYamlForm(snapshot);
  let finish!: () => void;
  const request = form.validate(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  form.change(`${source}\n# newer draft`);
  finish();
  await request;
  expect(form.getState()).toMatchObject({ validation: "idle", message: "", dirty: true });
  await form.validate(async () => undefined);
  expect(form.getState().validation).toBe("valid");
  form.change(`${source}\n# changed again`);
  expect(form.getState()).toMatchObject({ validation: "idle", message: "" });
});

it("preserves a dirty draft across a new revision and refuses to overwrite it until explicit reload", async () => {
  const form = openChannelYamlForm(snapshot);
  const draft = `${source}\n# my edits`;
  form.change(draft);
  const latest = {
    source: formatChannelConfigurationYaml({ ...candidate, accounts: [] }),
    revisionId: "revision-2",
  };
  form.applySnapshot(latest);
  const save = vi.fn();
  await form.activate(save);
  expect(save).not.toHaveBeenCalled();
  expect(form.getState()).toMatchObject({ source: draft, stale: true, dirty: true });
  form.reload();
  expect(form.getState()).toMatchObject({ source: latest.source, stale: false, dirty: false });
});

it("keeps invalid or failed drafts without claiming activation", async () => {
  const form = openChannelYamlForm(snapshot);
  const save = vi.fn().mockResolvedValue(false);
  form.change("policy: [");
  await form.activate(save);
  expect(save).not.toHaveBeenCalled();
  expect(form.getState().validation).toBe("error");
  form.change(`${source}\n# retry later`);
  await form.activate(save);
  expect(form.getState()).toMatchObject({ dirty: true, saving: false, message: "" });
});

it("ignores old validation after closing and locks a pending activation against duplicate writes", async () => {
  const form = openChannelYamlForm(snapshot);
  let validateDone!: () => void;
  const validation = form.validate(
    () =>
      new Promise<void>((resolve) => {
        validateDone = resolve;
      }),
  );
  form.close();
  validateDone();
  await validation;
  expect(form.getState().validation).not.toBe("valid");
  form.change(`${source}\n# edited`);
  let saveDone!: (result: boolean) => void;
  const save = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        saveDone = resolve;
      }),
  );
  const saving = form.activate(save);
  await form.activate(save);
  form.change("must not replace pending source");
  expect(save).toHaveBeenCalledTimes(1);
  expect(form.getState().source).toContain("# edited");
  saveDone(true);
  await saving;
});
