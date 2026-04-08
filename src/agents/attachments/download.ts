export const DEFAULT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

export async function downloadRemoteBuffer(params: {
  url: string;
  headers?: Record<string, string>;
  maxBytes?: number;
}) {
  const maxBytes = params.maxBytes ?? DEFAULT_ATTACHMENT_MAX_BYTES;
  const response = await fetch(params.url, {
    headers: params.headers,
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`download failed with HTTP ${response.status}`);
  }

  const headerLength = Number.parseInt(
    response.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(headerLength) && headerLength > maxBytes) {
    throw new Error(`attachment exceeds ${maxBytes} bytes`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new Error(`attachment exceeds ${maxBytes} bytes`);
  }

  return {
    buffer,
    contentType: response.headers.get("content-type") ?? undefined,
  };
}
