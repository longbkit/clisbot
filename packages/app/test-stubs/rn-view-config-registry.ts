// The web renderer does not consult native view configs; the registry only
// needs to exist so spec files can register into it.
const configs = new Map<string, unknown>();

export const customBubblingEventTypes: Record<string, unknown> = {};
export const customDirectEventTypes: Record<string, unknown> = {};

export function register(name: string, callback: () => unknown): string {
  configs.set(name, callback());
  return name;
}
export function get(name: string): unknown {
  return configs.get(name) ?? null;
}
