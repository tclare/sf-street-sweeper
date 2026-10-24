// The Shortcuts parameter arrives in several shapes; all should reach the right mode.
require("./scriptable-mock");
const test = require("node:test");
const assert = require("node:assert");
const { run } = require("../src/sweep");

test("dictionary, JSON text, bare mode name and odd casing all work", async () => {
  for (const input of [{ mode: "clear" }, '{"mode":"clear"}', "clear", " Clear ", { Mode: "Clear" }]) {
    assert.deepEqual(await run(input), {}, JSON.stringify(input));
  }
});

test("falls back to Scriptable args when the loader passes nothing", async () => {
  globalThis.args = { shortcutParameter: null, plainTexts: ['{"mode":"clear"}'], queryParameters: {} };
  try {
    assert.deepEqual(await run({}), {});
  } finally {
    delete globalThis.args;
  }
});

test("input without a mode explains what was received", async () => {
  await assert.rejects(run({ lat: 1 }), /Unknown mode: undefined\. Received \{"lat":1\}\..*Parameter field/);
  await assert.rejects(run("bogus"), /Unknown mode: bogus/);
});
