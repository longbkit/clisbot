// upstream: extensions/whatsapp/src/session.runtime.ts@3928bad9bad
// Whatsapp plugin module implements session behavior.
import { DEFAULT_CONNECTION_CONFIG } from "baileys";

export function createBaileysSignalRepository(
  ...args: Parameters<typeof DEFAULT_CONNECTION_CONFIG.makeSignalRepository>
) {
  return DEFAULT_CONNECTION_CONFIG.makeSignalRepository(...args);
}

export {
  BufferJSON,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
} from "baileys";
export { useMultiFileAuthState } from "./fusion/auth-state.js";
