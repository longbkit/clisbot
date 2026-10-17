const assert = require("node:assert/strict");
const { test } = require("node:test");
const { execFileSync } = require("node:child_process");
const { minify } = require("terser");
const vm = require("node:vm");
const path = require("node:path");
function config(enabled) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "-e",
        "console.log(JSON.stringify(require('./metro.config.cjs').transformer.minifierConfig))",
      ],
      {
        cwd: path.resolve(__dirname, ".."),
        encoding: "utf8",
        env: { ...process.env, CLISBOT_WEB_UTF8_EXPORT: enabled ? "1" : "0" },
      },
    ),
  );
}
test("deployment export uses UTF-8 while default native/desktop configuration stays ASCII", () => {
  const baseline = config(false),
    web = config(true);
  assert.equal(baseline.output.ascii_only, true);
  assert.equal(web.output.ascii_only, false);
  assert.deepEqual(web, { ...baseline, output: { ...baseline.output, ascii_only: false } });
});
test("installed minifier preserves multilingual text, emoji, separators, NUL and literal escapes", async () => {
  const expected = ["Tiếng Việt", "日本語", "😀", "\u2028\u2029", "\0", "\\u1234"];
  const source = `globalThis.result = ${JSON.stringify(expected)};`;
  const before = await minify(source, config(false));
  const after = await minify(source, config(true));
  const context = {};
  vm.runInNewContext(after.code, context);
  assert.equal(JSON.stringify(context.result), JSON.stringify(expected));
  assert(Buffer.byteLength(after.code) < Buffer.byteLength(before.code));
});
