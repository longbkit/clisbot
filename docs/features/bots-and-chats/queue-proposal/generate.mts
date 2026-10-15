import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { contracts } from "./contracts.mjs";
for (const [name, schema] of Object.entries(contracts)) {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input", reused: "ref" });
  Object.assign(json, {
    $id: `https://clisbot.com/schemas/proposals/cto-021/v1/${name}.schema.json`,
    title: `PROPOSED CTO-021 v1 ${name}; not implemented wire`,
  });
  await writeFile(
    new URL(`./${name}.schema.json`, import.meta.url),
    JSON.stringify(json, null, 2) + "\n",
  );
  console.log(`generated ${name}.schema.json`);
}
execFileSync(
  "npm",
  [
    "run",
    "format:files",
    "--",
    ...Object.keys(contracts).map((name) =>
      fileURLToPath(new URL(`./${name}.schema.json`, import.meta.url)),
    ),
  ],
  {
    cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
    stdio: "inherit",
  },
);
