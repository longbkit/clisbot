import {
  ProjectGitInspectResponseSchema,
  ProjectGitFetchResponseSchema,
} from "@clisbot/protocol/messages";
import type { ChannelDaemonSocket } from "./client.js";
import type { InboundMessage } from "../plane/types.js";
import type { ChannelOperationSource } from "./session-operation.js";

function requireFeature(socket: ChannelDaemonSocket) {
  const features = socket.serverInfo?.["features"] as Record<string, unknown> | undefined;
  if (features?.["projectGitCommands"] !== true)
    throw new Error("Update this Host to support Git commands.");
}
function gitInspector(socket: ChannelDaemonSocket) {
  return async (projectId: string, fields: Record<string, unknown>) => {
    requireFeature(socket);
    const result = ProjectGitInspectResponseSchema.shape.payload.parse(
      await socket.call("project.git.inspect.request", { projectId, ...fields }, 45_000),
    );
    if (result.projectId !== projectId) throw new Error("Host returned a different Project.");
    if (result.error) throw new Error(result.error);
    return result;
  };
}
async function gitPages(
  inspect: ReturnType<typeof gitInspector>,
  projectId: string,
  kind: "branches" | "worktrees",
) {
  const pages = [];
  for (let offset = 0; ; offset += 200) {
    const result = await inspect(projectId, { kind, offset, limit: 200 });
    pages.push(result);
    const rows = kind === "branches" ? result.branches : result.worktrees;
    if (!rows) throw new Error("Host did not return Git discovery data.");
    if (rows.length < 200) return pages;
  }
}
export function createProjectGitClient(
  socket: ChannelDaemonSocket,
  identify: (
    type: string,
    payload: Record<string, unknown>,
    source?: ChannelOperationSource,
  ) => Promise<Record<string, unknown>>,
) {
  const inspect = gitInspector(socket);
  return {
    listGitBranches: async (projectId: string) =>
      (await gitPages(inspect, projectId, "branches"))
        .flatMap((p) => p.branches ?? [])
        .map((b) => Object.assign(b, { committerDate: Date.parse(b.commit.committedAt) / 1000 })),
    listGitWorktrees: async (projectId: string) =>
      (await gitPages(inspect, projectId, "worktrees")).flatMap((p) => p.worktrees ?? []),
    inspectGitWorktree: async (projectId: string, path: string) => {
      const result = await inspect(projectId, { kind: "worktree", path });
      if (!result.inspection) throw new Error("Host did not report worktree status.");
      return result.inspection;
    },
    fetchGitRemote: async (projectId: string, remote: string, source: InboundMessage) => {
      requireFeature(socket);
      const fields = await identify("project.git.fetch.request", { projectId, remote }, source);
      const result = ProjectGitFetchResponseSchema.shape.payload.parse(
        await socket.call("project.git.fetch.request", fields, 45_000),
      );
      if (result.projectId !== projectId || result.remote !== remote)
        throw new Error("Host returned a different fetch target.");
      if (result.error) throw new Error(result.error);
      if (!result.fetchedAt) throw new Error("Host did not confirm the fetch.");
      return result.fetchedAt;
    },
  };
}
