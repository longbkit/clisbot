// upstream: src/infra/outbound/message-action-denial.ts@5d8067a4483
export class MessageActionDeniedError extends Error {
  constructor(
    message: string,
    readonly reasonCode: string,
    readonly policyRef: string,
  ) {
    super(message);
    this.name = "MessageActionDeniedError";
  }
}
