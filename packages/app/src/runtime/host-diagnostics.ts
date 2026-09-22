import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Why a Host left the app's registry, or why a route sent someone away from it.
 *
 * A kick to Welcome is followed by a page reload, which clears the browser console unless
 * "Preserve log" is on. Each event is therefore also appended to a small persisted ring, which
 * survives the reload: run `await paseoHostDiagnostics()` in the browser console to read it.
 */
const STORAGE_KEY = "@paseo:host-diagnostics-v1";
const MAX_EVENTS = 100;
const GLOBAL_READER = "paseoHostDiagnostics";

export interface HostDiagnosticEvent {
  at: string;
  event: string;
  path: string | null;
  [detail: string]: unknown;
}

export interface HostDiagnosticStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

let storage: HostDiagnosticStorage = AsyncStorage;
let writeTail: Promise<void> = Promise.resolve();

export function setHostDiagnosticStorageForTests(next: HostDiagnosticStorage): void {
  storage = next;
  writeTail = Promise.resolve();
}

export function recordHostDiagnostic(event: string, detail: Record<string, unknown> = {}): void {
  const entry: HostDiagnosticEvent = {
    at: new Date().toISOString(),
    event,
    path: currentPath(),
    ...detail,
  };
  console.warn(`[paseo:host] ${event}`, entry);
  writeTail = writeTail.then(() => appendEvent(entry)).catch(() => undefined);
}

async function appendEvent(entry: HostDiagnosticEvent): Promise<void> {
  const events = await readHostDiagnostics();
  events.push(entry);
  await storage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
}

export async function readHostDiagnostics(): Promise<HostDiagnosticEvent[]> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HostDiagnosticEvent[]) : [];
  } catch {
    return [];
  }
}

/** The caller chain without this module's own frames, to name an unexpected trigger. */
export function diagnosticStack(): string | undefined {
  return new Error().stack?.split("\n").slice(2, 10).join("\n");
}

function currentPath(): string | null {
  const location = (globalThis as { location?: { pathname?: string; search?: string } }).location;
  return location?.pathname === undefined ? null : `${location.pathname}${location.search ?? ""}`;
}

Reflect.set(globalThis, GLOBAL_READER, readHostDiagnostics);
