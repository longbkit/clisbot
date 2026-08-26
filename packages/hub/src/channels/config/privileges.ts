// The closed privilege algebra (implementation doc §4.3.7).
//
// Privileges nest by dot: `approval.command` covers `approval.command.destructive`.
// A grant covers its dot-subtree; `*` and `<name>.*` are the wildcard forms.
// `deny` subtracts within the same role only, never across `extends` — the
// operator role's grants `[approval.command]` + deny `[approval.command.destructive]`
// therefore approves commands but not destructive ones.
// Fail-closed split: an unknown privilege pattern in an *authored* grant is a
// compile error (the compiler rejects it); an unknown role name at *decision*
// time contributes nothing (it simply resolves to no grants).

/** `granted` covers `wanted` under the dot-nesting + wildcard rules. */
export function privilegeCovers(granted: string, wanted: string): boolean {
  if (granted === "*") return true;
  if (granted.endsWith(".*")) {
    const family = granted.slice(0, -2);
    return wanted === family || wanted.startsWith(`${family}.`);
  }
  return wanted === granted || wanted.startsWith(`${granted}.`);
}

export interface CompiledRole {
  grants: readonly string[];
  deny: readonly string[];
  extends: readonly string[];
}

/** True when this role's own grants cover `wanted` and its own deny does not. */
export function roleGrants(role: CompiledRole, wanted: string): boolean {
  const granted = role.grants.some((entry) => privilegeCovers(entry, wanted));
  if (!granted) return false;
  return !role.deny.some((entry) => privilegeCovers(entry, wanted));
}

/**
 * Effective privileges of a set of roles (the extends-closure is precomputed):
 * `wanted` holds when any one role grants it without its own deny subtracting.
 * Each role is checked against its own grants/deny, so denies never reach
 * across `extends` (implementation doc §4.3.7).
 */
export function rolesGrant(roles: readonly CompiledRole[], wanted: string): boolean {
  return roles.some((role) => roleGrants(role, wanted));
}
