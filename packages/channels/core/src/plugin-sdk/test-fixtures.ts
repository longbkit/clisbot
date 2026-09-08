// Fusion-owned boundary for `src/plugin-sdk/test-fixtures.ts` (D-CORE-270).
//
// Upstream's barrel is the whole shared test-fixture surface (CLI runtime
// capture, sandbox contexts, skill writers, agent message fixtures, system
// events, terminal text). Only the two fixtures the ported Slack tests import
// are carried, from the same source modules.
export {
  createRequireRecord,
  type RecordRequirementKind,
  type RecordRequirementMessage,
} from "../test/helpers/record.js";
export {
  createGrayscaleAlphaPngBuffer,
  createNoisyPngBuffer,
  createSolidPngBuffer,
} from "./test-helpers/image-fixtures.js";

// Slice 13 addition (Discord vertical port): the ported Discord chunk tests
// import the markdown chunk helpers from this same upstream barrel.
export { countLines, hasBalancedFences } from "../test-utils/chunk-test-helpers.js";
