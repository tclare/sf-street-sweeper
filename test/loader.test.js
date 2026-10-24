// Tests for scriptable/Sweep.js: fresh downloads win, broken or missing ones fall back to the cache.
const { delivered } = require("./scriptable-mock");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const LOADER = fs.readFileSync(path.join(__dirname, "../scriptable/Sweep.js"), "utf8");
const AsyncFunction = (async () => {}).constructor;
const lib = version => `module.exports = { run: async input => ({ version: ${version}, mode: input.mode }) };`;

async function runLoader({ body = "", status = 200, offline = false }) {
  let output;
  const saved = { Request: globalThis.Request, warn: console.warn };
  globalThis.Request = class {
    async loadString() {
      if (offline) throw new Error("offline");
      this.response = { statusCode: status };
      return body;
    }
  };
  globalThis.importModule = p => { delete require.cache[require.resolve(p)]; return require(p); };
  globalThis.args = { shortcutParameter: { mode: "clear" } };
  globalThis.Script = { setShortcutOutput: o => { output = o; }, complete() {} };
  console.warn = () => {};
  try {
    await new AsyncFunction(LOADER)();
  } finally {
    globalThis.Request = saved.Request;
    console.warn = saved.warn;
  }
  return output;
}

test("offline with no cache reports an error", async () => {
  const out = await runLoader({ offline: true });
  assert.match(out.error, /No cached sweep.js/);
  assert.equal(delivered.at(-1).title, "Street Sweeping Error");
});

test("a good download runs and passes the Shortcuts parameter through", async () => {
  assert.deepEqual(await runLoader({ body: lib(1) }), { version: 1, mode: "clear" });
});

test("a broken push falls back to the last good copy", async () => {
  assert.deepEqual(await runLoader({ body: "module.exports = {" }), { version: 1, mode: "clear" });
});

test("an HTTP error falls back to the last good copy", async () => {
  assert.deepEqual(await runLoader({ body: "404: Not Found", status: 404 }), { version: 1, mode: "clear" });
});

test("a new good version replaces the cache", async () => {
  assert.deepEqual(await runLoader({ body: lib(2) }), { version: 2, mode: "clear" });
  assert.deepEqual(await runLoader({ offline: true }), { version: 2, mode: "clear" });
});
