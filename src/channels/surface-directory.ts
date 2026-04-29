import { dirname, join } from "node:path";
import type { ChannelIdentity } from "./channel-identity.ts";
import {
  buildSurfacePromptContext,
  type SurfacePromptContext,
} from "./surface-prompt-context.ts";
import { ensureDir, fileExists, readTextFile, writeTextFile } from "../shared/fs.ts";

type Platform = "slack" | "telegram";

export type SenderDirectoryRecord = {
  senderId: string;
  platform: Platform;
  providerId: string;
  displayName?: string;
  handle?: string;
  updatedAt: number;
  expiresAt?: number;
};

export type SurfaceDirectoryRecord = {
  surfaceId: string;
  platform: Platform;
  kind: "dm" | "channel" | "group" | "topic";
  providerId?: string;
  displayName?: string;
  parentSurfaceId?: string;
  updatedAt: number;
  expiresAt?: number;
};

type SurfaceDirectoryShape = {
  version: 1;
  senders: Record<string, SenderDirectoryRecord>;
  surfaces: Record<string, SurfaceDirectoryRecord>;
};

const pathLocks = new Map<string, Promise<void>>();

function emptyDirectory(): SurfaceDirectoryShape {
  return {
    version: 1,
    senders: {},
    surfaces: {},
  };
}

function resolveDirectoryPath(stateDir: string) {
  return join(stateDir, "surface-directory.json");
}

function platformFromSurfaceId(surfaceId: string): Platform {
  return surfaceId.startsWith("slack:") ? "slack" : "telegram";
}

async function readDirectory(pathname: string): Promise<SurfaceDirectoryShape> {
  if (!(await fileExists(pathname))) {
    return emptyDirectory();
  }
  const parsed = JSON.parse(await readTextFile(pathname)) as Partial<SurfaceDirectoryShape>;
  return {
    version: 1,
    senders: parsed.senders ?? {},
    surfaces: parsed.surfaces ?? {},
  };
}

async function withDirectoryLock<T>(pathname: string, work: () => Promise<T>) {
  const previous = pathLocks.get(pathname) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const lock = previous.then(() => next);
  pathLocks.set(pathname, lock);

  await previous;
  try {
    return await work();
  } finally {
    release();
    if (pathLocks.get(pathname) === lock) {
      pathLocks.delete(pathname);
    }
  }
}

function upsertSurface(
  directory: SurfaceDirectoryShape,
  surface: ReturnType<typeof buildSurfacePromptContext>["surface"],
  now: number,
) {
  const platform = platformFromSurfaceId(surface.surfaceId);
  if (surface.parent) {
    const existingParent = directory.surfaces[surface.parent.surfaceId];
    directory.surfaces[surface.parent.surfaceId] = {
      ...existingParent,
      surfaceId: surface.parent.surfaceId,
      platform,
      kind: surface.parent.surfaceId.includes(":group:") ? "group" : "channel",
      providerId: surface.parent.providerId ?? existingParent?.providerId,
      displayName: surface.parent.displayName ?? existingParent?.displayName,
      updatedAt: now,
    };
  }
  const existingSurface = directory.surfaces[surface.surfaceId];
  directory.surfaces[surface.surfaceId] = {
    ...existingSurface,
    surfaceId: surface.surfaceId,
    platform,
    kind: surface.kind,
    providerId: surface.providerId ?? existingSurface?.providerId,
    displayName: surface.displayName ?? existingSurface?.displayName,
    parentSurfaceId: surface.parent?.surfaceId ?? existingSurface?.parentSurfaceId,
    updatedAt: now,
  };
}

function enrichSender(
  sender: SurfacePromptContext["sender"],
  directory: SurfaceDirectoryShape,
) {
  if (!sender) {
    return undefined;
  }
  const record = directory.senders[sender.senderId];
  if (!record) {
    return sender;
  }
  return {
    ...sender,
    displayName: sender.displayName ?? record.displayName,
    handle: sender.handle ?? record.handle,
  };
}

function enrichSurface(
  surface: SurfacePromptContext["surface"],
  directory: SurfaceDirectoryShape,
): SurfacePromptContext["surface"] {
  const record = directory.surfaces[surface.surfaceId];
  const parentRecord = surface.parent
    ? directory.surfaces[surface.parent.surfaceId]
    : undefined;
  const parent = surface.parent
    ? {
        ...surface.parent,
        displayName: surface.parent.displayName ?? parentRecord?.displayName,
      }
    : undefined;
  return {
    ...surface,
    displayName: surface.displayName ?? record?.displayName,
    parent,
  };
}

export async function buildSurfacePromptContextWithDirectory(params: {
  stateDir: string;
  identity: ChannelIdentity;
  agentId?: string;
  time?: number | string | Date;
  scheduledLoopId?: string;
}): Promise<SurfacePromptContext> {
  const context = buildSurfacePromptContext(params);
  try {
    const directory = await readDirectory(resolveDirectoryPath(params.stateDir));
    return {
      ...context,
      sender: enrichSender(context.sender, directory),
      surface: enrichSurface(context.surface, directory),
    };
  } catch {
    return context;
  }
}

export async function recordSurfaceDirectoryIdentity(params: {
  stateDir: string;
  identity: ChannelIdentity;
}) {
  const context = buildSurfacePromptContext({ identity: params.identity });
  const pathname = resolveDirectoryPath(params.stateDir);
  await withDirectoryLock(pathname, async () => {
    const directory = await readDirectory(pathname);
    const now = Date.now();

    if (context.sender) {
      const existingSender = directory.senders[context.sender.senderId];
      directory.senders[context.sender.senderId] = {
        ...existingSender,
        ...context.sender,
        platform: params.identity.platform,
        displayName: context.sender.displayName ?? existingSender?.displayName,
        handle: context.sender.handle ?? existingSender?.handle,
        updatedAt: now,
      };
    }
    upsertSurface(directory, context.surface, now);

    await ensureDir(dirname(pathname));
    await writeTextFile(pathname, `${JSON.stringify(directory, null, 2)}\n`);
  });
}
