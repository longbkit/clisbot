/** Offline record-only rollback. Stop the daemon before invoking this command. */
import path from "node:path";
import { acquirePidLock, releasePidLock } from "../src/server/pid-lock.js";
import { rollbackSessionLayout } from "../src/server/agent/session-storage/layout.js";

const [baseDir, acknowledgement] = process.argv.slice(2);
if (!baseDir || acknowledgement !== "--daemon-stopped") {
  throw new Error(
    "Usage: tsx packages/server/scripts/rollback-session-layout.ts <PASEO_HOME>/agents --daemon-stopped (stop daemon first; journals/uploads are retained)",
  );
}
const directory = path.resolve(baseDir);
if (path.basename(directory) !== "agents")
  throw new Error("Expected the agents directory of a Paseo home");
const paseoHome = path.dirname(directory);
// Hold the daemon's exclusive lock for the entire operation, including against concurrent startup.
await acquirePidLock(paseoHome, null);
try {
  const migrated = await rollbackSessionLayout(directory);
  process.stdout.write(`Rolled back ${migrated} session records; journals and uploads retained.\n`);
} finally {
  await releasePidLock(paseoHome);
}
