const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export class MissingEnvVarError extends Error {
  constructor(
    public readonly varName: string,
    public readonly configPath: string,
  ) {
    super(`Missing env var "${varName}" referenced at config path: ${configPath}`);
    this.name = "MissingEnvVarError";
  }
}

export function renderMissingEnvVarErrorLines(error: MissingEnvVarError) {
  return [
    `error missing env var: ${error.varName}`,
    `config path: ${error.configPath}`,
    "Set the env var in your shell and reload it, or update the token placeholder in config.",
  ];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function substituteString(value: string, env: NodeJS.ProcessEnv, configPath: string): string {
  if (!value.includes("$")) {
    return value;
  }

  const chunks: string[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "$") {
      chunks.push(char);
      continue;
    }

    const next = value[index + 1];
    const afterNext = value[index + 2];

    if (next === "$" && afterNext === "{") {
      const start = index + 3;
      const end = value.indexOf("}", start);
      if (end !== -1) {
        const name = value.slice(start, end);
        if (ENV_VAR_NAME_PATTERN.test(name)) {
          chunks.push(`\${${name}}`);
          index = end;
          continue;
        }
      }
    }

    if (next === "{") {
      const start = index + 2;
      const end = value.indexOf("}", start);
      if (end !== -1) {
        const name = value.slice(start, end);
        if (ENV_VAR_NAME_PATTERN.test(name)) {
          const envValue = env[name];
          if (envValue === undefined || envValue === "") {
            throw new MissingEnvVarError(name, configPath);
          }
          chunks.push(envValue);
          index = end;
          continue;
        }
      }
    }

    chunks.push(char);
  }

  return chunks.join("");
}

function substituteAny(value: unknown, env: NodeJS.ProcessEnv, path: string): unknown {
  if (typeof value === "string") {
    return substituteString(value, env, path);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => substituteAny(item, env, `${path}[${index}]`));
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, childValue] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      result[key] = substituteAny(childValue, env, childPath);
    }
    return result;
  }

  return value;
}

export function resolveConfigEnvVars(
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
): unknown {
  return substituteAny(value, env, "");
}
