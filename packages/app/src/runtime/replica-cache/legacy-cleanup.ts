import AsyncStorage from "@react-native-async-storage/async-storage";

const LEGACY_STORAGE_KEY = "@clisbot:replica-cache";

export async function clearLegacyReplicaCache(): Promise<void> {
  await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
}
