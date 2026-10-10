import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  QuickStartSchema,
  QuickStartPreferencesSchema,
  quickStartOwnerKey,
  type QuickStart,
  type QuickStartInput,
  type QuickStartOwner,
  type QuickStartTarget,
} from "@clisbot/protocol/quick-starts/types";
import { writeJsonFileAtomic } from "../atomic-file.js";

const StateSchema = z.object({
  schemaVersion: z.literal(1),
  items: z.array(QuickStartSchema),
  preferences: z.array(QuickStartPreferencesSchema),
});
type State = z.infer<typeof StateSchema>;
export interface QuickStartAuthority {
  owner: QuickStartOwner;
  administrator: boolean;
  canUse(target: QuickStartTarget): Promise<boolean>;
}
export class QuickStartError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
function conflict() {
  throw new QuickStartError(
    "conflict",
    "Quick starts changed on another device. Refresh and try again.",
  );
}
export class QuickStartStore {
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  constructor(private readonly file: string) {}
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private async read(): Promise<State> {
    try {
      return StateSchema.parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { schemaVersion: 1, items: [], preferences: [] };
      throw error;
    }
  }
  private owns(item: QuickStart, authority: QuickStartAuthority) {
    return quickStartOwnerKey(item.owner) === quickStartOwnerKey(authority.owner);
  }
  private async project(state: State, authority: QuickStartAuthority) {
    const views = await Promise.all(
      state.items.map(async (item) => {
        const own = this.owns(item, authority);
        const available = await authority.canUse(item.target);
        if (!own && (item.visibility !== "host" || !available)) return null;
        return { ...item, available, canEdit: own || authority.administrator };
      }),
    );
    const items = views.filter((item) => item !== null);
    const stored = state.preferences.find(
      (p) => quickStartOwnerKey(p.owner) === quickStartOwnerKey(authority.owner),
    );
    const preferences = stored ?? { owner: authority.owner, pinnedIds: [], revision: 0 };
    return {
      items,
      preferences: {
        ...preferences,
        pinnedIds: preferences.pinnedIds.filter((id) => items.some((item) => item.id === id)),
      },
    };
  }
  async list(authority: QuickStartAuthority) {
    await this.queue.catch(() => undefined);
    return this.project(await this.read(), authority);
  }
  private mutate(authority: QuickStartAuthority, fn: (state: State) => Promise<void>) {
    const task = this.queue
      .catch(() => undefined)
      .then(async () => {
        const state = await this.read();
        await fn(state);
        await writeJsonFileAtomic(this.file, StateSchema.parse(state));
        for (const listener of this.listeners) listener();
        return this.project(state, authority);
      });
    this.queue = task;
    return task;
  }
  save(
    authority: QuickStartAuthority,
    id: string,
    expectedRevision: number,
    input: QuickStartInput,
  ) {
    return this.mutate(authority, async (state) => {
      const old = state.items.find((item) => item.id === id);
      if (
        old &&
        !this.owns(old, authority) &&
        !(old.visibility === "host" && authority.administrator)
      )
        throw new QuickStartError("access_denied", "Only the creator can edit this quick start.");
      if ((old?.revision ?? 0) !== expectedRevision) conflict();
      const name = input.name.trim();
      if (!name) throw new QuickStartError("invalid_request", "Enter a name.");
      // Owners can stop sharing an unavailable target, but cannot publish or retarget it.
      const onlyUnpublish = isOnlyUnpublish(old, input);
      if (!onlyUnpublish && !(await authority.canUse(input.target)))
        throw new QuickStartError(
          "target_unavailable",
          "This destination is unavailable or your access does not allow starting a chat there.",
        );
      const now = new Date().toISOString();
      const item = QuickStartSchema.parse({
        ...input,
        name,
        id,
        owner: old?.owner ?? authority.owner,
        revision: expectedRevision + 1,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
      });
      state.items = [...state.items.filter((entry) => entry.id !== id), item];
      if (item.visibility === "personal") pruneOtherPins(state.preferences, item);
    });
  }
  remove(authority: QuickStartAuthority, id: string, expectedRevision: number) {
    return this.mutate(authority, async (state) => {
      const item = state.items.find((entry) => entry.id === id);
      if (
        !item ||
        (!this.owns(item, authority) && !(item.visibility === "host" && authority.administrator))
      )
        throw new QuickStartError("not_found", "Quick start not found.");
      if (item.revision !== expectedRevision) conflict();
      state.items = state.items.filter((entry) => entry.id !== id);
      for (const p of state.preferences)
        if (p.pinnedIds.includes(id)) {
          p.pinnedIds = p.pinnedIds.filter((pin) => pin !== id);
          p.revision++;
        }
    });
  }
  setPins(authority: QuickStartAuthority, pinnedIds: string[], expectedRevision: number) {
    return this.mutate(authority, async (state) => {
      const view = await this.project(state, authority);
      if (view.preferences.revision !== expectedRevision) conflict();
      const unique = [...new Set(pinnedIds)];
      if (unique.some((id) => !view.items.some((item) => item.id === id)))
        throw new QuickStartError(
          "not_found",
          "A quick start is no longer available. Refresh the list.",
        );
      state.preferences = [
        ...state.preferences.filter(
          (p) => quickStartOwnerKey(p.owner) !== quickStartOwnerKey(authority.owner),
        ),
        { owner: authority.owner, pinnedIds: unique, revision: expectedRevision + 1 },
      ];
    });
  }
}

function isOnlyUnpublish(old: QuickStart | undefined, input: QuickStartInput) {
  if (!old || input.visibility !== "personal") return false;
  return isDeepStrictEqual(
    {
      name: input.name,
      target: input.target,
      startingPrompt: input.startingPrompt,
      agent: input.agent,
    },
    { name: old.name, target: old.target, startingPrompt: old.startingPrompt, agent: old.agent },
  );
}
function pruneOtherPins(preferences: State["preferences"], item: QuickStart) {
  for (const p of preferences) {
    if (
      quickStartOwnerKey(p.owner) !== quickStartOwnerKey(item.owner) &&
      p.pinnedIds.includes(item.id)
    ) {
      p.pinnedIds = p.pinnedIds.filter((id) => id !== item.id);
      p.revision++;
    }
  }
}
