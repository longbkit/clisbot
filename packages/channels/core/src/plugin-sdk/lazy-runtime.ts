// upstream: src/plugin-sdk/lazy-runtime.ts@5d8067a4483
// Lazy module/promise helpers for plugin runtimes.
export { createLazyRuntimeModule } from "../shared/lazy-runtime.js";

// Slice 13 addition (Discord vertical port): the ported Discord outbound
// component adapter binds one named export lazily rather than a whole module.
export { createLazyRuntimeNamedExport } from "../shared/lazy-runtime.js";
