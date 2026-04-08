import {
  MissingEnvVarError,
  renderMissingEnvVarErrorLines,
} from "../config/env-substitution.ts";
import { renderOperatorHelpLines } from "./startup-bootstrap.ts";

export function renderOperatorErrorLines(error: unknown) {
  if (error instanceof MissingEnvVarError) {
    return renderMissingEnvVarErrorLines(error);
  }

  const message = error instanceof Error ? error.message : String(error);
  return [`error ${message}`];
}

export function renderRuntimeErrorLines(context: string, error: unknown) {
  if (error instanceof MissingEnvVarError) {
    return renderMissingEnvVarErrorLines(error);
  }

  const message = error instanceof Error ? error.message : String(error);
  return [`${context}: ${message}`];
}

export function renderOperatorErrorWithHelpLines(error: unknown) {
  return [
    ...renderOperatorErrorLines(error),
    ...renderOperatorHelpLines(),
  ];
}
