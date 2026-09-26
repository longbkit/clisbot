/**
 * Terminal profiles and Project folder narrowing on Host and Project grants
 * (docs/features/access/terminal-and-project-creation.md). Kept apart from the
 * store so the rules read in one place: what a grant may carry, and how the
 * grants that apply to one Project combine.
 */
import {
  TerminalProfileCatalogSchema,
  type AccessAssignmentInput,
  type ProjectFolderRules,
  type TerminalProfileCatalog,
  type TerminalProfileSelection,
} from "./contract.js";

/** The rule every assignment's Terminal and folder constraints must satisfy. */
export function terminalAndFolderConstraintError(
  assignment: Pick<AccessAssignmentInput, "resourceKind" | "privileges" | "constraints">,
): string | null {
  const { resourceKind, privileges, constraints } = assignment;
  const hostOrProject = resourceKind === "daemon" || resourceKind === "project";
  if (constraints.terminalProfiles !== undefined) {
    if (!hostOrProject) return "Terminal profile constraints apply only to Hosts and Projects";
    if (!privileges.includes("terminal.profile.use")) {
      return "Terminal profile constraints require terminal.profile.use";
    }
  }
  if (privileges.includes("terminal.profile.use") && constraints.terminalProfiles === undefined) {
    return "terminal.profile.use requires Terminal profiles";
  }
  if (constraints.projectFolders !== undefined) {
    // Only a Host grant creates Projects; a Project grant would create nested ones.
    if (resourceKind !== "daemon") return "Project folder rules apply only to Hosts";
    if (!privileges.includes("workspace.manage")) {
      return "Project folder rules require workspace.manage";
    }
  }
  return null;
}

/** Union of the Terminal profiles the applicable grants name; `*` covers all. */
export function unionTerminalProfiles(
  constraints: ReadonlyArray<AccessAssignmentInput["constraints"]>,
): TerminalProfileSelection | undefined {
  const selections = constraints.flatMap(({ terminalProfiles }) =>
    terminalProfiles === undefined ? [] : [terminalProfiles],
  );
  if (selections.length === 0) return undefined;
  if (selections.some((selection) => selection === "*")) return "*";
  return [...new Set(selections.flatMap((selection) => (selection === "*" ? [] : selection)))];
}

/**
 * One rule set per Host grant that creates Projects. A grant without narrowing
 * creates wherever the Host policy allows, written as `allow: ["**"]`.
 */
export function projectCreationRules(
  hostGrants: ReadonlyArray<Pick<AccessAssignmentInput, "privileges" | "constraints">>,
): ProjectFolderRules[] {
  return hostGrants
    .filter(({ privileges }) => privileges.includes("workspace.manage"))
    .map(({ constraints }) => constraints.projectFolders ?? { allow: ["**"], deny: [] });
}

/** The Terminal profiles a Host published with its Project snapshot, if any. */
export function parseTerminalProfileCatalog(
  metadata: unknown,
): { terminalProfileCatalog: TerminalProfileCatalog } | Record<never, never> {
  if (typeof metadata !== "object" || metadata === null) return {};
  const parsed = TerminalProfileCatalogSchema.safeParse(
    Reflect.get(metadata, "terminalProfileCatalog"),
  );
  return parsed.success ? { terminalProfileCatalog: parsed.data } : {};
}
