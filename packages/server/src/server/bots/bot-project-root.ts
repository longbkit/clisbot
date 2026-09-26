import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

/** The container of Bot homes is not itself a Project (D3). */
export async function assertNotBotProjectRoot(
  cwd: string,
  root: string | undefined,
): Promise<void> {
  if (!root) return;
  const [candidate, reserved] = await Promise.all([
    realpath(cwd).catch(() => resolve(cwd)),
    realpath(root).catch(() => resolve(root)),
  ]);
  if (candidate === reserved)
    throw new Error("The Bots root contains Bot homes and cannot be opened as a Project.");
}
