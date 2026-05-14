import type {
  ChannelCredentialChannelId,
  ChannelCredentialFieldKey,
} from "./channel-credential-contract.ts";
import {
  listChannelCredentialSkipPaths,
} from "./channel-credential-contract.ts";
import { extractEnvReferenceName, normalizeEnvReference } from "../env/env-references.ts";
import type { ChannelBotRecord } from "./channel-config-shapes.ts";

const TOKEN_ENV_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export type ChannelPersistentBotConfig = ChannelBotRecord;

export type RuntimeCredentialDocument = Partial<
  Record<
    ChannelCredentialChannelId,
    Record<string, Partial<Record<ChannelCredentialFieldKey, string>>>
  >
>;

export type ParsedTokenInput =
  | {
      kind: "env";
      envName: string;
      placeholder: string;
    }
  | {
      kind: "mem";
      secret: string;
    };

export type ResolvedCredentialSource =
  | {
      source: "cli-ephemeral";
      detail: string;
    }
  | {
      source: "credential-file";
      detail: string;
      paths: string[];
    }
  | {
      source: "env";
      detail: string;
      names: string[];
    }
  | {
      source: "config-inline";
      detail: string;
    };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function trimString(value?: string) {
  return value?.trim() ?? "";
}

export function getCredentialSkipPaths(parsed: unknown) {
  return listChannelCredentialSkipPaths(parsed);
}

export function parseTokenInput(value: string): ParsedTokenInput {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Expected a token value or env reference");
  }

  const normalizedEnv = normalizeEnvReference(trimmed);
  const envName = extractEnvReferenceName(normalizedEnv);
  if (envName) {
    return {
      kind: "env",
      envName,
      placeholder: `\${${envName}}`,
    };
  }

  if (TOKEN_ENV_PATTERN.test(trimmed)) {
    return {
      kind: "env",
      envName: trimmed,
      placeholder: `\${${trimmed}}`,
    };
  }

  return {
    kind: "mem",
    secret: trimmed,
  };
}
