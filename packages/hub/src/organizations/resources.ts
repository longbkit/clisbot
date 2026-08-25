import type { AgentExecutionRecord, DaemonRecord, Database, MachineRecord } from "../db/types.js";
import type { OrganizationAccessValue } from "../auth/organization-access.js";

export class OrganizationResources {
  constructor(private readonly database: Database) {}

  forOrganization(access: OrganizationAccessValue): OrganizationResourceReader {
    return new OrganizationResourceReader(this.database, access.organization.id);
  }
}

export class OrganizationResourceReader {
  constructor(
    private readonly database: Database,
    private readonly organizationId: string,
  ) {}

  machine(id: string): Promise<MachineRecord | undefined> {
    return this.database.findMachineForOrganization(this.organizationId, id);
  }

  daemon(id: string): Promise<DaemonRecord | undefined> {
    return this.database.findDaemonForOrganization(this.organizationId, id);
  }

  execution(id: string): Promise<AgentExecutionRecord | undefined> {
    return this.database.findAgentExecutionForOrganization(this.organizationId, id);
  }
}
