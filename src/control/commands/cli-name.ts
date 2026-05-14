export const DEFAULT_CLISBOT_CLI_NAME = "clisbot";
const CLISBOT_CLI_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

let renderedCliName = DEFAULT_CLISBOT_CLI_NAME;

export type RenderCliCommandOptions = {
  cliName?: string;
  inline?: boolean;
};

export function normalizeClisbotCliName(cliName?: string | null) {
  const configured = cliName?.trim();
  if (!configured) {
    return DEFAULT_CLISBOT_CLI_NAME;
  }

  return CLISBOT_CLI_NAME_PATTERN.test(configured)
    ? configured
    : DEFAULT_CLISBOT_CLI_NAME;
}

export function getRenderedCliName() {
  return renderedCliName;
}

export function setRenderedCliName(cliName?: string | null) {
  renderedCliName = normalizeClisbotCliName(cliName);
  return renderedCliName;
}

export function renderCliCommand(
  command = "",
  options: RenderCliCommandOptions = {},
) {
  const cliName = options.cliName
    ? normalizeClisbotCliName(options.cliName)
    : getRenderedCliName();
  const suffix = command.trim();
  const rendered = suffix ? `${cliName} ${suffix}` : cliName;
  return options.inline ? `\`${rendered}\`` : rendered;
}
