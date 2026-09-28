import { isAbsolutePath } from "@/utils/path";
/** Capture the selected bot's source when inserting a reference, never at submit time. */
export function conversationFilePath(cwd: string | null | undefined, path: string): string {
  if (isAbsolutePath(path) || !cwd) return path;
  return `${cwd.replace(/[\\/]$/, "")}/${path.replace(/^\.\//, "")}`;
}
