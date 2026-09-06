import { compileAutomationDocument } from "./configuration/workflow-document.js";
import type {
  Database,
  OrganizationTriggerRecord,
  OrganizationTriggerRevisionRecord,
} from "../db/types.js";
import { resolveTriggerConfigurationForOrganization } from "../configuration/store.js";
import { TriggerDocumentError } from "./configuration/index.js";

export interface SaveTriggerInput {
  triggerId?: string;
  yaml: string;
  userId: string | null;
  sourceKind?: "manual" | "github";
  sourceEvidence?: unknown;
  expectedActiveRevisionId?: string | null;
}

export interface SaveTriggerOptions {
  authorize?: (candidate: PreparedOrganizationTrigger) => Promise<void>;
}

export interface PreparedOrganizationTrigger {
  compiled: ReturnType<typeof compileAutomationDocument>;
  resolved: Extract<
    Awaited<ReturnType<typeof resolveTriggerConfigurationForOrganization>>,
    { success: true }
  >;
}

export class OrganizationTriggerStore {
  constructor(
    private readonly database: Database,
    private readonly organizationId: string,
  ) {}

  list(): Promise<OrganizationTriggerRecord[]> {
    return this.database.listOrganizationTriggers(this.organizationId);
  }

  async activeRevision(
    trigger: OrganizationTriggerRecord,
  ): Promise<OrganizationTriggerRevisionRecord> {
    if (trigger.organizationId !== this.organizationId) {
      throw new Error("organization trigger not found");
    }
    const revision = await this.database.findOrganizationTriggerRevision(
      trigger.id,
      trigger.activeRevisionId,
    );
    if (revision === undefined) throw new Error("active trigger revision not found");
    return revision;
  }

  async save(
    input: SaveTriggerInput,
    options: SaveTriggerOptions = {},
  ): Promise<OrganizationTriggerRecord> {
    const unchangedAuthoring = await this.isUnchangedExistingYaml(input);
    const prepared = await this.validate(input.yaml, !unchangedAuthoring);
    await options.authorize?.(prepared);
    return this.database.saveOrganizationTrigger({
      organizationId: this.organizationId,
      ...(input.triggerId === undefined ? {} : { triggerId: input.triggerId }),
      name: prepared.compiled.authored.name,
      enabled: prepared.compiled.authored.enabled,
      format: prepared.compiled.format,
      yaml: input.yaml,
      normalizedConfiguration: prepared.resolved.configuration,
      contentHash: prepared.compiled.authoredHash,
      sourceKind: input.sourceKind ?? "manual",
      sourceEvidence: input.sourceEvidence ?? {
        kind: "manual",
        authoredFormat: "self_contained_trigger_v1",
      },
      createdByUserId: input.userId,
      routes: prepared.compiled.authored.enabled ? prepared.resolved.routes : [],
      ...(input.expectedActiveRevisionId === undefined
        ? {}
        : { expectedActiveRevisionId: input.expectedActiveRevisionId }),
    });
  }

  async validate(
    yaml: string,
    enforceAuthoringContract = true,
  ): Promise<PreparedOrganizationTrigger> {
    const compiled = compileAutomationDocument(yaml);
    if (enforceAuthoringContract) validateAuthoringContract(compiled.authored);
    const resolved = await resolveTriggerConfigurationForOrganization(
      this.database,
      this.organizationId,
      {
        environments: compiled.environments,
        triggers: compiled.events,
      },
    );
    if (!resolved.success) {
      throw new TriggerDocumentError(resolved.issues);
    }
    return { compiled, resolved };
  }

  private async isUnchangedExistingYaml(input: SaveTriggerInput): Promise<boolean> {
    if (input.triggerId === undefined) return false;
    const trigger = (await this.list()).find(({ id }) => id === input.triggerId);
    if (trigger === undefined) return false;
    return (await this.activeRevision(trigger)).yaml === input.yaml;
  }
}

function validateAuthoringContract(
  trigger: ReturnType<typeof compileAutomationDocument>["authored"],
): void {
  const issues: Array<{ path: readonly (string | number)[]; message: string }> = [];
  const targets =
    "run" in trigger
      ? [trigger.run.target]
      : trigger.environments.filter((target) => target.kind === "daemon");
  targets.forEach((target, index) => {
    if (!target.cwd?.startsWith("/"))
      issues.push({ path: ["environments", index, "cwd"], message: "must be an absolute path" });
  });
  if (issues.length > 0) throw new TriggerDocumentError(issues);
}
