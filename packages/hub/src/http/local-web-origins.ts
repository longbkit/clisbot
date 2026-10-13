import { readFileSync } from "node:fs";

/** OS-owned local-web admission file. This is transport admission, never the Hub issuer. */
export function localWebOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const file = env["CLISBOT_HUB_LOCAL_WEB_ORIGINS_FILE"];
  if (!file) return [];
  try {
    const values: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(values) || values.length > 8) return [];
    return values.filter((value): value is string => {
      if (typeof value !== "string") return false;
      try {
        const url = new URL(value);
        return (
          url.origin === value &&
          !url.username &&
          !url.password &&
          ((url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)) ||
            (url.protocol === "https:" && url.hostname.endsWith(".ts.net")))
        );
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}
