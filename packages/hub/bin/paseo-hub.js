#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { configureRuntimeRoot } from "../dist/runtime-files.js";

configureRuntimeRoot(fileURLToPath(new URL("..", import.meta.url)));
const { runHubCommandLine } = await import("../dist/index.js");
runHubCommandLine();
