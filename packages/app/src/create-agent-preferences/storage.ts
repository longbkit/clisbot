import AsyncStorage from "@react-native-async-storage/async-storage";
import { readValidatedJson } from "@/storage/validated-storage";
import {
  FormPreferencesSchema,
  StoredFormPreferencesSchema,
  type FormPreferences,
} from "./preferences";

export const CREATE_AGENT_PREFERENCES_STORAGE_KEY = "@clisbot:create-agent-preferences";

export interface CreateAgentPreferenceStorage {
  read(): Promise<unknown>;
  write(preferences: FormPreferences): Promise<void>;
}

export class AsyncStorageCreateAgentPreferenceStorage implements CreateAgentPreferenceStorage {
  private readonly key: string;

  constructor(serverId?: string | null) {
    this.key = serverId
      ? `${CREATE_AGENT_PREFERENCES_STORAGE_KEY}:host:${encodeURIComponent(serverId)}`
      : CREATE_AGENT_PREFERENCES_STORAGE_KEY;
  }

  async read(): Promise<unknown> {
    const stored = await readValidatedJson(AsyncStorage, this.key, StoredFormPreferencesSchema);
    if (stored !== null || this.key === CREATE_AGENT_PREFERENCES_STORAGE_KEY) return stored;
    // Seed each Host once from existing device preferences. The provider resolver
    // validates this legacy selection against that Host's complete catalogue.
    const legacy = await readValidatedJson(
      AsyncStorage,
      CREATE_AGENT_PREFERENCES_STORAGE_KEY,
      StoredFormPreferencesSchema,
    );
    await this.write(legacy ?? {});
    return legacy;
  }

  async write(preferences: FormPreferences): Promise<void> {
    const result = FormPreferencesSchema.safeParse(preferences);
    if (!result.success) {
      await AsyncStorage.removeItem(this.key);
      return;
    }
    await AsyncStorage.setItem(this.key, JSON.stringify(result.data));
  }
}
