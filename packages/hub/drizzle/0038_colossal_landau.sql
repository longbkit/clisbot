UPDATE "runtime_provider_configuration"
SET "configuration" = jsonb_set("configuration", '{transport}', '"webhook"'::jsonb, true)
WHERE "provider" = 'slack' AND NOT ("configuration" ? 'transport');
