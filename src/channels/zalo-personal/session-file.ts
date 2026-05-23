import { chmod, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileExists, readTextFile } from "../../infra/fs.ts";
import { collapseHomePath, ensureDir, expandHomePath } from "../../infra/paths.ts";

export type ZaloPersonalAuthSession = {
  version: 1;
  cookie: unknown[];
  imei: string;
  userAgent: string;
  language?: string;
  savedAt: string;
  user?: {
    name?: string;
    avatar?: string;
  };
};

function assertString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid Zalo Personal auth/session file: missing ${label}.`);
  }
  return value;
}

export function resolveZaloPersonalSessionPath(tokenFile: string) {
  return expandHomePath(tokenFile);
}

export async function readZaloPersonalAuthSession(tokenFile: string) {
  const path = resolveZaloPersonalSessionPath(tokenFile);
  if (!(await fileExists(path))) {
    return null;
  }
  const parsed = JSON.parse(await readTextFile(path)) as Partial<ZaloPersonalAuthSession>;
  if (parsed.version !== 1) {
    throw new Error("Invalid Zalo Personal auth/session file: unsupported version.");
  }
  if (!Array.isArray(parsed.cookie)) {
    throw new Error("Invalid Zalo Personal auth/session file: missing cookie.");
  }
  return {
    version: 1,
    cookie: parsed.cookie,
    imei: assertString(parsed.imei, "imei"),
    userAgent: assertString(parsed.userAgent, "userAgent"),
    language: typeof parsed.language === "string" && parsed.language.trim()
      ? parsed.language.trim()
      : undefined,
    savedAt: assertString(parsed.savedAt, "savedAt"),
    user: parsed.user,
  } satisfies ZaloPersonalAuthSession;
}

export async function writeZaloPersonalAuthSession(
  tokenFile: string,
  session: ZaloPersonalAuthSession,
) {
  const path = resolveZaloPersonalSessionPath(tokenFile);
  await ensureDir(dirname(path));
  await writeFile(path, `${JSON.stringify(session, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(path, 0o600);
  return path;
}

export async function removeZaloPersonalAuthSession(tokenFile: string) {
  await rm(resolveZaloPersonalSessionPath(tokenFile), { force: true });
}

export async function describeZaloPersonalAuthSession(tokenFile: string) {
  const path = resolveZaloPersonalSessionPath(tokenFile);
  if (!(await fileExists(path))) {
    return {
      loggedIn: false,
      detail: `missing path=${collapseHomePath(path)}`,
    };
  }
  let session: ZaloPersonalAuthSession | null;
  try {
    session = await readZaloPersonalAuthSession(tokenFile);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      loggedIn: false,
      detail: `invalid path=${collapseHomePath(path)} reason=${reason}`,
    };
  }
  return {
    loggedIn: true,
    detail: `present path=${collapseHomePath(path)} savedAt=${session?.savedAt ?? "unknown"}`,
    user: session?.user,
  };
}
