CREATE TABLE "daemon_enrollment_tokens" (
  "id" uuid PRIMARY KEY,
  "verifier" text NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone
);

CREATE TABLE "daemons" (
  "id" uuid PRIMARY KEY,
  "idempotency_key" text NOT NULL UNIQUE,
  "enrollment_verifier" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "machine_id" uuid NOT NULL REFERENCES "machines"("id"),
  "server_id" text NOT NULL,
  "daemon_public_key" text NOT NULL,
  "credential_verifier" text NOT NULL,
  "scopes" jsonb NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('active', 'revoked')),
  "presence" text NOT NULL DEFAULT 'offline' CHECK ("presence" IN ('offline', 'connected')),
  "connected_at" timestamp with time zone,
  "disconnected_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "agent_executions" ADD COLUMN "daemon_id" uuid REFERENCES "daemons"("id");
ALTER TABLE "agent_executions" ADD COLUMN "daemon_agent_id" text;
ALTER TABLE "agent_executions" ADD COLUMN "trigger_id" uuid;
ALTER TABLE "agent_executions" ADD COLUMN "launch_intent" jsonb;
