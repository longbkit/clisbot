// Regenerates docs/features/runners/capability-matrix.md from the provider
// catalog. Run via: bun run docs:capability-matrix
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderCapabilityMatrixMarkdown } from "../src/runners/catalog/capability-table.ts";

const target = join(import.meta.dir, "..", "docs", "features", "runners", "capability-matrix.md");
writeFileSync(target, renderCapabilityMatrixMarkdown());
console.log(`wrote ${target}`);
