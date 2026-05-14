import { access, mkdir, readFile, writeFile } from "node:fs/promises";

export async function ensureDir(pathname: string) {
  await mkdir(pathname, { recursive: true });
}

export async function fileExists(pathname: string) {
  try {
    await access(pathname);
    return true;
  } catch {
    return false;
  }
}

export async function readTextFile(pathname: string) {
  return await readFile(pathname, "utf8");
}

export async function readTextFileSlice(pathname: string, startOffset = 0) {
  const buffer = await readFile(pathname);
  return buffer.subarray(Math.max(0, startOffset)).toString("utf8");
}

export async function writeTextFile(pathname: string, text: string) {
  await writeFile(pathname, text, "utf8");
}

export async function writeFileBuffer(pathname: string, data: Buffer) {
  await writeFile(pathname, data);
}
