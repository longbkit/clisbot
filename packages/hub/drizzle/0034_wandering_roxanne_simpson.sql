CREATE TABLE "runtime_configuration" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"auth_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_configuration_singleton_check" CHECK ("runtime_configuration"."singleton")
);
