import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import {
  fetchProjectGitRemote,
  inspectProjectGitWorktree,
  listProjectGitBranches,
  listProjectGitWorktrees,
} from "../project-git.js";
type Request = Extract<
  SessionInboundMessage,
  { type: "project.git.inspect.request" | "project.git.fetch.request" }
>;
export async function handleProjectGitRequest(
  deps: {
    projectRoot(id: string): Promise<string | undefined>;
    emit(message: SessionOutboundMessage): void;
  },
  request: Request,
): Promise<void> {
  const { projectId, requestId } = request;
  try {
    const cwd = await deps.projectRoot(projectId);
    if (!cwd) throw new Error("Project is unavailable.");
    if (request.type === "project.git.fetch.request") {
      const fetchedAt = await fetchProjectGitRemote(cwd, request.remote);
      deps.emit({
        type: "project.git.fetch.response",
        payload: { projectId, requestId, remote: request.remote, fetchedAt, error: null },
      });
      return;
    }
    const start = request.offset ?? 0,
      end = start + (request.limit ?? 200);
    let result;
    if (request.kind === "branches")
      result = { branches: (await listProjectGitBranches(cwd)).slice(start, end) };
    else if (request.kind === "worktrees")
      result = { worktrees: (await listProjectGitWorktrees(cwd)).slice(start, end) };
    else result = { inspection: await inspectProjectGitWorktree(cwd, request.path ?? cwd) };
    deps.emit({
      type: "project.git.inspect.response",
      payload: { projectId, requestId, ...result, error: null },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Git operation failed.";
    if (request.type === "project.git.fetch.request")
      deps.emit({
        type: "project.git.fetch.response",
        payload: { projectId, requestId, remote: request.remote, error: detail },
      });
    else
      deps.emit({
        type: "project.git.inspect.response",
        payload: { projectId, requestId, error: detail },
      });
  }
}
