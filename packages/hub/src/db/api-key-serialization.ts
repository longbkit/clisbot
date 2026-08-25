const apiKeyQueues = new Map<string, Promise<void>>();

export async function withApiKeySerialization<T>(
  apiKeyId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = apiKeyQueues.get(apiKeyId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  apiKeyQueues.set(apiKeyId, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (apiKeyQueues.get(apiKeyId) === current) apiKeyQueues.delete(apiKeyId);
  }
}
