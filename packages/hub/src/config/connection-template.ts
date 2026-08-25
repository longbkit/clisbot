import type { ConnectionResolutionContext, ConnectionResolver } from "./connections.js";

const CONNECTION_EXPRESSION =
  /^\s*paseo\.connections\.([a-z0-9]+(?:-[a-z0-9]+)*)\.([a-z][a-z0-9_-]*)\s*$/u;

export interface ConnectionReference {
  slug: string;
  value: string;
}

export function validateConnectionTemplate(template: string, path: string): void {
  parseConnectionTemplate(template, path);
}

export function parseConnectionTemplate(
  template: string,
  path = "environment",
): readonly ConnectionReference[] {
  const references: ConnectionReference[] = [];
  let cursor = 0;

  while (cursor < template.length) {
    const start = template.indexOf("${{", cursor);
    if (start < 0) break;
    const end = template.indexOf("}}", start + 3);
    if (end < 0) {
      throw new Error(
        `${path} contains an unterminated interpolation; expected paseo.connections.<slug>.<value>`,
      );
    }
    const expression = template.slice(start + 3, end);
    const match = CONNECTION_EXPRESSION.exec(expression);
    if (match === null) {
      throw new Error(
        `${path} contains unsupported interpolation ${template.slice(start, end + 2)}; expected paseo.connections.<slug>.<value>`,
      );
    }
    references.push({ slug: match[1]!, value: match[2]! });
    cursor = end + 2;
  }

  return references;
}

export async function resolveConnectionTemplate(
  template: string,
  resolver: ConnectionResolver,
  context: ConnectionResolutionContext,
  path = "environment",
): Promise<string> {
  const references = parseConnectionTemplate(template, path);
  if (references.length === 0) return template;

  const resolved = new Map<string, Promise<string>>();
  let cursor = 0;
  let result = "";
  for (const reference of references) {
    const expression = `paseo.connections.${reference.slug}.${reference.value}`;
    const start = template.indexOf("${{", cursor);
    const end = template.indexOf("}}", start + 3);
    if (start < 0 || end < 0) throw new Error(`invalid connection template at ${path}`);
    result += template.slice(cursor, start);
    const key = `${reference.slug}:${reference.value}`;
    let value = resolved.get(key);
    if (value === undefined) {
      value = Promise.resolve(resolver(reference.slug, reference.value, context));
      resolved.set(key, value);
    }
    result += await value;
    cursor = end + 2;
    if (template.slice(start + 3, end).trim() !== expression) {
      throw new Error(`invalid connection template at ${path}`);
    }
  }
  return result + template.slice(cursor);
}
