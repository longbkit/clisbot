// upstream: extensions/feishu/src/api-response.ts@5d8067a4483
export function assertFeishuApiSuccess(
  response: { code?: number; msg?: string },
  errorPrefix: string,
): void {
  if (response.code !== 0) {
    throw new Error(`${errorPrefix}: ${response.msg || `code ${response.code}`}`);
  }
}
