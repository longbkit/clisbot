// Dump the active revision's telegram channel account config (apiRoot/timeoutSeconds/botToken presence).
import process from "node:process";
import Pglite from "@electric-sql/pglite";
const HOME = process.env.CLISBOT_HOME;
const db = await Pglite.create(HOME + "/hub/db", { allowOffline: true }).catch(() => null);
// Fallback: read via the inspector path
