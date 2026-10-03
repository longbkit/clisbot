import { runSupervisor } from "@clisbot/server/supervisor";
import { startServiceControl } from "./service-control.js";
import {
  nodeEntrypointArguments,
  packagedNodeEntrypointRunner,
} from "../../utils/node-entrypoint.js";

const controlled = process.argv[2] === "--control-file";
const workerIndex = controlled ? 4 : 2;
const worker = process.argv[workerIndex];
if (!worker) throw new Error("Missing service worker entry");
let controller: ReturnType<typeof runSupervisor>;
const control = controlled
  ? await startServiceControl(process.argv[3]!, () => controller.requestShutdown("cli"))
  : undefined;
controller = runSupervisor({
  name: "Clisbot service",
  startupMessage: "Starting independent service",
  resolveWorkerEntry: () => worker,
  workerArgs: process.argv.slice(workerIndex + 1),
  ...(control ? { onSupervisorExit: () => control.close() } : {}),
  workerExecArgv: worker.endsWith(".ts") ? ["--import", "tsx"] : [],
  resolveWorkerSpawnSpec: packagedNodeEntrypointRunner(worker)
    ? () => ({
        command: process.execPath,
        args: nodeEntrypointArguments(worker, process.argv.slice(workerIndex + 1)),
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      })
    : undefined,
  restartOnCrash: true,
});
