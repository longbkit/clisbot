import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentAttachment } from "../messages.js";
import type { SessionFileReference, SessionMessageFiles } from "./session-files.js";

/** Internal, already-authorized ownership transfer; never accepted from a client payload. */
export interface RetainedForkFiles {
  attachments?: AgentAttachment[];
  links: SessionMessageFiles;
}

async function validateRetainedFile(directory: string, file: SessionFileReference): Promise<void> {
  if (
    !file.id.startsWith("fork_") ||
    /[\\/]/.test(file.id + file.fileName) ||
    (file.id + file.fileName).includes("\0") ||
    file.fileName === "." ||
    file.fileName === ".." ||
    file.relativePath !== path.join("uploads", file.id, file.fileName)
  )
    throw new Error("Invalid retained fork file reference");
  const stat = await fs.lstat(path.join(directory, file.relativePath));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size)
    throw new Error("Retained fork attachment is missing or incomplete");
}

export async function appendRetainedForkFiles(input: {
  directory: string;
  attachment: AgentAttachment;
  attachmentIndex: number;
  retained?: RetainedForkFiles;
  files: SessionFileReference[];
  paths: NonNullable<SessionMessageFiles["forkPaths"]>;
}): Promise<boolean> {
  const { retained, attachment } = input;
  if (!retained || attachment.type !== "text" || !attachment.sourceSession) return false;
  const anchor = JSON.stringify(attachment.sourceSession);
  const previousIndex =
    retained.attachments?.findIndex(
      (old) =>
        old.type === "text" &&
        old.contextKind === "chat_history" &&
        JSON.stringify(old.sourceSession) === anchor,
    ) ?? -1;
  if (previousIndex < 0) return false;
  if (!retained.links.forkSources?.some((source) => JSON.stringify(source) === anchor))
    throw new Error("Retained fork provenance is incomplete");
  for (const mapping of retained.links.forkPaths ?? []) {
    if (mapping.attachmentIndex !== previousIndex) continue;
    const file = retained.links.files.find(
      (candidate) => candidate.relativePath === mapping.targetRelativePath,
    );
    if (!file) throw new Error("Retained fork file link is missing");
    await validateRetainedFile(input.directory, file);
    if (!input.files.some((existing) => existing.id === file.id)) input.files.push(file);
    input.paths.push({ ...mapping, attachmentIndex: input.attachmentIndex });
  }
  return true;
}
