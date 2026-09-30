import { spawn } from "node:child_process";
import { readFileSync, accessSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function servicesForMode(mode = "daemon") {
  if (mode === "all") return ["daemon", "hub"];
  if (mode === "daemon" || mode === "hub") return [mode];
  throw new Error(`Invalid CLISBOT_RUN_MODE '${mode}'; expected daemon, hub, or all`);
}

// Size-guide exception: this lifecycle closure keeps child ownership, signal
// handlers and the shutdown timer together so teardown cannot outlive its owner.
export function runServices(mode, entries) {
  const services = servicesForMode(mode);
  for (const service of services) accessSync(entries[service]);
  const children = new Map();
  let stopping = false;
  let timer;

  function signalGroup(child, signal) {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }

  function finish() {
    if (children.size) return;
    clearTimeout(timer);
    process.removeListener("SIGTERM", shutdown);
    process.removeListener("SIGINT", shutdown);
  }

  function stop(code) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children.values()) signalGroup(child, "SIGTERM");
    timer = setTimeout(() => {
      for (const child of children.values()) signalGroup(child, "SIGKILL");
    }, 25_000);
    finish();
  }

  function shutdown() {
    stop(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  for (const service of services) {
    console.log(`[clisbot] starting ${service}`);
    const child = spawn(process.execPath, [entries[service]], {
      stdio: "inherit",
      detached: true,
    });
    children.set(service, child);
    child.on("error", (error) => {
      console.error(`[clisbot] ${service} failed to start: ${error.message}`);
      children.delete(service);
      stop(1);
      finish();
    });
    child.on("exit", (code, signal) => {
      children.delete(service);
      signalGroup(child, "SIGTERM");
      if (!stopping) {
        console.error(`[clisbot] ${service} exited (${signal ?? code}); stopping container`);
        stop(code || 1);
      }
      finish();
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.env.CLISBOT_RUN_MODE ?? "daemon";
  const entries = Object.fromEntries(
    servicesForMode(mode).map((service) => [
      service,
      readFileSync(`/etc/clisbot-${service === "daemon" ? "server" : "hub"}-entry`, "utf8").trim(),
    ]),
  );
  runServices(mode, entries);
}
