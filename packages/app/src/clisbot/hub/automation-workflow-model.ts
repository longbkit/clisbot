import { parseDocument, stringify } from "yaml";

type ObjectValue = Record<string, unknown>;
export function record(value: unknown): ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
}
/** Expand the shorthand without changing event reply permissions or the original step id. */
export function expandAutomationWorkflow(source: string, preserveShorthand = false): string {
  const document = parseDocument(source);
  if (document.errors.length) throw document.errors[0];
  const value = record(document.toJS());
  if (!value.run) return source;
  const run = record(value.run);
  const outputs = Object.entries(record(run.outputs)).map(([type, grant]) => ({
    type,
    ...record(grant),
  }));
  const eventProviders = Object.keys(record(value.on)).map((event) => event.split(".")[0]);
  const implicitReplies = new Set(
    eventProviders.filter(
      (provider) =>
        ["slack", "discord", "github", "linear"].includes(provider) &&
        !outputs.some((output) => output.type === `${provider}.reply`),
    ),
  );
  if (
    !preserveShorthand &&
    [...implicitReplies].some((provider) => eventProviders.some((other) => other !== provider))
  ) {
    throw new Error(
      "These inputs have different native reply permissions. Set explicit reply limits before adding steps so conversion does not broaden access.",
    );
  }
  for (const event of Object.keys(record(value.on))) {
    const provider = event.split(".")[0];
    if (!preserveShorthand && ["slack", "discord", "github", "linear"].includes(provider)) {
      const type = `${provider}.reply`;
      if (!outputs.some((output) => output.type === type)) outputs.push({ type });
    }
  }
  const agent = record(run.agent);
  const { target, outputs: _outputs, prompt, ...step } = run;
  document.delete("run");
  document.set("environments", [{ name: "target", kind: "daemon", ...record(target) }]);
  if (agent.choices) document.set("agents", agent.choices);
  document.set("max_runtime", value.max_runtime ?? run.max_runtime ?? "2h");
  document.set("steps", [
    {
      ...step,
      max_runtime: step.max_runtime ?? "2h",
      idle_timeout: step.idle_timeout ?? "10m",
      auto_archive: step.auto_archive ?? true,
      id: "run",
      environment: "target",
      agent: agent.choices ? agent.select : run.agent,
      prompt: [{ text: prompt }],
      allow_outputs: outputs,
    },
  ]);
  return document.toString({ lineWidth: 0 });
}

export function openAutomationWorkflow(source: string) {
  let shorthand = Boolean(record(parseDocument(source).toJS()).run);
  let document = parseDocument(expandAutomationWorkflow(source, true));
  const listeners = new Set<() => void>();
  let nextKey = 0;
  let stepKeys = (record(document.toJS()).steps as unknown[]).map(() => nextKey++);
  let version = 0;
  const errors = new Map<string, string>();
  let state = snapshot();
  function snapshot() {
    const value = record(document.toJS());
    return {
      stepKeys: [...stepKeys],
      version,
      errors: [...errors.values()],
      yaml: serialize(),
      value,
      steps: Array.isArray(value.steps) ? value.steps.map(record) : [],
      environments: Array.isArray(value.environments) ? value.environments.map(record) : [],
    };
  }
  function serialize() {
    if (!shorthand) return document.toString({ lineWidth: 0 });
    const copy = document.clone();
    const value = record(copy.toJS());
    const step = record((value.steps as unknown[])[0]);
    const { id: _id, environment: _environment, allow_outputs, prompt, ...run } = step;
    const { name: _name, kind: _kind, ...target } = record((value.environments as unknown[])[0]);
    copy.set("run", {
      ...run,
      target,
      agent:
        typeof run.agent === "string" ? { select: run.agent, choices: value.agents } : run.agent,
      prompt: (prompt as unknown[]).map((block) => record(block).text ?? "").join("\n"),
      outputs: Object.fromEntries(
        (Array.isArray(allow_outputs) ? allow_outputs : []).map((grant) => {
          const { type, ...permission } = record(grant);
          return [String(type), permission];
        }),
      ),
    });
    for (const key of ["steps", "environments", "agents"]) copy.delete(key);
    return copy.toString({ lineWidth: 0 });
  }
  function publish() {
    state = snapshot();
    listeners.forEach((listener) => listener());
  }
  return {
    getState: () => state,
    setError(key: string, error: string | null) {
      if (error) errors.set(key, error);
      else errors.delete(key);
      publish();
    },
    separateEnvironment(index: number) {
      if (shorthand) {
        document = parseDocument(expandAutomationWorkflow(serialize()));
        shorthand = false;
      }

      const previous = state.environments.find(
        (value) => value.name === state.steps[index].environment,
      );
      let number = state.environments.length + 1;
      while (state.environments.some((value) => value.name === `target_${number}`)) number++;
      const name = `target_${number}`;
      document.addIn(["environments"], document.createNode({ ...previous, name }));
      document.setIn(["steps", index, "environment"], name);
      publish();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(path: (string | number)[], value: unknown) {
      if (JSON.stringify(document.getIn(path)) === JSON.stringify(value)) return;
      if (
        shorthand &&
        (path[0] === "values" ||
          (path[0] === "steps" && ["if", "id", "environment"].includes(String(path[2]))))
      ) {
        document = parseDocument(expandAutomationWorkflow(serialize()));
        shorthand = false;
      }

      if (value === undefined) document.deleteIn(path);
      else document.setIn(path, document.createNode(value));
      publish();
    },
    replaceYaml(source: string) {
      const input = parseDocument(source);
      if (input.errors.length) throw input.errors[0];
      const candidateShorthand = Boolean(record(input.toJS()).run);
      const candidate = parseDocument(expandAutomationWorkflow(source, true));
      if (candidate.errors.length) throw candidate.errors[0];
      if (!Array.isArray(record(candidate.toJS()).steps))
        throw new Error("Workflow needs a steps list.");
      document = candidate;
      shorthand = candidateShorthand;
      stepKeys = (record(candidate.toJS()).steps as unknown[]).map(() => nextKey++);
      version++;
      errors.clear();
      publish();
    },
    addStep() {
      if (shorthand) {
        document = parseDocument(expandAutomationWorkflow(serialize()));
        shorthand = false;
      }

      const previous = state.steps.at(-1);
      let index = state.steps.length + 1;
      while (state.steps.some((step) => step.id === `step_${index}`)) index++;
      document.addIn(
        ["steps"],
        document.createNode({
          id: `step_${index}`,
          environment: previous?.environment ?? state.environments[0]?.name ?? "target",
          agent: previous?.agent ?? { provider: "" },
          prompt: [{ text: "${{ paseo.prompt }}" }],
          max_runtime: "2h",
          idle_timeout: "10m",
          auto_archive: true,
        }),
      );
      stepKeys.push(nextKey++);
      publish();
    },
    removeStep(index: number) {
      if (state.steps.length === 1) throw new Error("A Workflow needs at least one step.");
      const id = String(state.steps[index]?.id);
      const rest = {
        ...state.value,
        steps: state.steps.filter((_, position) => position !== index),
      };
      if (stringify(rest).includes(`steps.${id}.`) || stringify(rest).includes(`steps.${id}\n`))
        throw new Error(
          `Other steps or values reference ${id}. Update those references before removing it.`,
        );
      document.deleteIn(["steps", index]);
      for (const key of errors.keys())
        if (key.startsWith(`${stepKeys[index]}:`)) errors.delete(key);
      stepKeys.splice(index, 1);
      publish();
    },
    moveStep(index: number, direction: -1 | 1) {
      const target = index + direction;
      if (target < 0 || target >= state.steps.length) return;
      const first = document.getIn(["steps", index], true);
      const second = document.getIn(["steps", target], true);
      document.setIn(["steps", index], second);
      document.setIn(["steps", target], first);
      [stepKeys[index], stepKeys[target]] = [stepKeys[target], stepKeys[index]];
      publish();
    },
  };
}
