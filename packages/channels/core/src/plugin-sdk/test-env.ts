// Fusion-owned boundary for `src/plugin-sdk/test-env.ts` (D-CORE-271).
//
// Upstream's barrel is the whole repo-local env/network/filesystem/time fixture
// surface (temp homes, state-dir guards, proxy fixtures, frozen time, SSRF
// hostname pinning). Only the local HTTP test server the ported Slack upload
// tests use is carried, from the same source module.
export { withServer } from "./test-helpers/http-test-server.js";
// Slice 9b addition (Telegram action-runtime tests): the env capture/restore
// helpers, carried from the same upstream source module (`src/test-utils/env.ts`).
export { captureEnv, deleteTestEnvValue, setTestEnvValue } from "./test-helpers/env.js";
