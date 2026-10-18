import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
addFormats(ajv);
const examples = JSON.parse(await readFile(new URL("./examples.json", import.meta.url)));
for (const name of ["record", "content", "command", "response"]) {
  const schema = JSON.parse(await readFile(new URL(`./${name}.schema.json`, import.meta.url)));
  const validate = ajv.compile(schema);
  for (const example of examples[name])
    assert.equal(validate(example), true, JSON.stringify(validate.errors));
  console.log(`PASS ${name}: ${examples[name].length} minimal Host queue examples`);
}
