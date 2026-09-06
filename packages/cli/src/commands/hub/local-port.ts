import { createServer } from "node:net";

/** Probe loopback before launching; callers persist the selected port for restart. */
export async function selectLocalPort(preferred: number, allowFallback: boolean): Promise<number> {
  try {
    return await bindLocalPort(preferred);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EADDRINUSE") throw error;
    if (allowFallback) return bindLocalPort(0);
    throw new Error(`Local port ${preferred} is already in use. Select another port.`, {
      cause: error,
    });
  }
}

function bindLocalPort(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Local port allocation returned no TCP address")));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}
