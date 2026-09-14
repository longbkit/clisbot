import AsyncStorage from "@react-native-async-storage/async-storage";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import type { AgentPermissionResponse } from "@getpaseo/protocol/agent-types";

interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
interface Attempt {
  key: string;
  id: string;
}
const STORAGE_KEY = "paseo:permission-response-attempts:v1";
const MAX_ATTEMPTS = 128;
const MAX_BYTES = 64 * 1024;
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  );
}

/** Durable logical IDs are written before the provider response is sent. */
export class PermissionResponseAttempts {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  constructor(
    private readonly storage: Storage = AsyncStorage,
    private readonly digest: (value: string) => Promise<string> = (value) =>
      digestStringAsync(CryptoDigestAlgorithm.SHA256, value),
    private readonly uuid: () => string = () => crypto.randomUUID(),
  ) {}
  private async read(): Promise<Attempt[]> {
    const text = await this.storage.getItem(STORAGE_KEY);
    if (!text) return [];
    if (text.length > MAX_BYTES)
      throw new Error("Saved permission attempts exceed their byte limit");
    const records: unknown = JSON.parse(text);
    if (
      !Array.isArray(records) ||
      records.length > MAX_ATTEMPTS ||
      records.some(
        (record) => !record || typeof record.key !== "string" || typeof record.id !== "string",
      )
    )
      throw new Error("Invalid saved permission attempts");
    return records;
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    if (this.pending >= 16)
      return Promise.reject(new Error("Too many pending permission responses"));
    this.pending += 1;
    const result = this.tail
      .catch(() => undefined)
      .then(operation)
      .finally(() => {
        this.pending -= 1;
      });
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async admit(input: {
    serverId: string;
    agentId: string;
    generation: string;
    response: AgentPermissionResponse;
  }): Promise<{ key: string; responseId: string }> {
    const serialized = JSON.stringify(stableValue(input));
    if (serialized.length > MAX_BYTES)
      throw new Error("Permission response exceeds the saved attempt byte limit");
    return this.serialize(async () => {
      const key = await this.digest(serialized);
      const records = await this.read();
      const existing = records.find((record) => record.key === key);
      if (existing) return { key, responseId: existing.id };
      if (records.length >= MAX_ATTEMPTS)
        throw new Error("Too many unresolved saved permission responses");
      const id = this.uuid();
      await this.storage.setItem(STORAGE_KEY, JSON.stringify([...records, { key, id }]));
      return { key, responseId: id };
    });
  }
  settled(key: string): Promise<void> {
    return this.serialize(async () => {
      const records = await this.read();
      await this.storage.setItem(
        STORAGE_KEY,
        JSON.stringify(records.filter((record) => record.key !== key)),
      );
    });
  }
}
export const permissionResponseAttempts = new PermissionResponseAttempts();
