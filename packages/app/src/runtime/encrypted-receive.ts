import type { ReceiveCodec } from "@clisbot/relay/e2ee";

// Web, Electron and Node retain the established JS implementation and handshake scheduling.
export const selectReceiveCodec: (() => Promise<ReceiveCodec | undefined>) | undefined = undefined;
