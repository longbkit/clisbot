export function toErrorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "access_denied"
  ) {
    return "You do not have permission to perform this action. Ask your administrator for access.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
