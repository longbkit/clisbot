import type {
  Database,
  OrganizationTriggerRecord,
  OrganizationTriggerRevisionRecord,
} from "../db/types.js";
import { resolveTriggerConfigurationForOrganization } from "../configuration/store.js";
import { compileTriggerDocument, TriggerDocumentError } from "./configuration/index.js";

export interface SaveTriggerInput {
  triggerId?: string;
  yaml: string;
  userId: string | null;
  sourceKind?: "manual" | "github";
  sourceEvidence?: unknown;
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

  async save(input: SaveTriggerInput): Promise<OrganizationTriggerRecord> {
    const unchangedLegacyAuthoring = await this.isUnchangedExistingYaml(input);
    const prepared = await this.validate(input.yaml, !unchangedLegacyAuthoring);
    return this.database.saveOrganizationTrigger({
      organizationId: this.organizationId,
      ...(input.triggerId === undefined ? {} : { triggerId: input.triggerId }),
      name: prepared.compiled.authored.name,
      enabled: prepared.compiled.authored.enabled,
      format: "single_run",
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
    });
  }

  async validate(yaml: string, enforceAuthoringContract = true) {
    const compiled = compileTriggerDocument(yaml);
    if (enforceAuthoringContract) validateAuthoringContract(compiled.authored);
    const resolved = await resolveTriggerConfigurationForOrganization(
      this.database,
      this.organizationId,
      {
        environments: [compiled.environment],
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
  trigger: ReturnType<typeof compileTriggerDocument>["authored"],
): void {
  const issues: Array<{ path: readonly (string | number)[]; message: string }> = [];
  if (!trigger.run.target.cwd.startsWith("/")) {
    issues.push({ path: ["run", "target", "cwd"], message: "must be an absolute path" });
  }
  if ("choices" in trigger.run.agent) {
    for (const [name, agent] of Object.entries(trigger.run.agent.choices)) {
      if (agent.mode === undefined) {
        issues.push({
          path: ["run", "agent", "choices", name, "mode"],
          message: "is required for new triggers",
        });
      }
    }
  } else if (trigger.run.agent.mode === undefined) {
    issues.push({
      path: ["run", "agent", "mode"],
      message: "is required for new triggers",
    });
  }
  if (issues.length > 0) throw new TriggerDocumentError(issues);
}
