// upstream: src/plugin-sdk/cli-runtime.ts@5d8067a4483
// D-CORE-702: upstream's deprecated CLI barrel re-exports OpenClaw's command
// formatter, command-group registration, argv parsing and terminal theme. Fusion
// has no OpenClaw CLI; the ported channel code reads only the command formatter
// (for operator-facing hints) and the build version, both from the
// `cli/command-format.host-adapter.ts` boundary.
export { formatCliCommand, VERSION } from "../cli/command-format.host-adapter.js";
