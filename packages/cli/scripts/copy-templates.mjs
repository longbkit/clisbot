import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(cliRoot, "src/commands/bot/templates");
const destination = join(cliRoot, "dist/commands/bot/templates");

await mkdir(dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true, force: true });
