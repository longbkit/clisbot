import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { Record, Content, Command, Response } from "./contracts.mjs";
for (const [name, schema] of Object.entries({
  record: Record,
  content: Content,
  command: Command,
  response: Response,
})) {
  await writeFile(
    new URL(`./${name}.schema.json`, import.meta.url),
    JSON.stringify(z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" }), null, 2) +
      "\n",
  );
}
