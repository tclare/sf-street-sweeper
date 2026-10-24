// Minimal stand-ins for the Scriptable APIs sweep.js uses, so it can run under Node.
const fs = require("fs");
const os = require("os");
const path = require("path");

const docs = process.env.SWEEP_STATE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "sweep-test-"));
fs.mkdirSync(docs, { recursive: true });
const delivered = [];
const pending = new Map();

globalThis.FileManager = {
  local: () => ({
    documentsDirectory: () => docs,
    joinPath: path.join,
    fileExists: fs.existsSync,
    readString: p => fs.readFileSync(p, "utf8"),
    writeString: (p, s) => fs.writeFileSync(p, s),
    remove: p => fs.unlinkSync(p),
    move: (from, to) => fs.renameSync(from, to),
  }),
};

globalThis.Request = class {
  constructor(url) { this.url = url; }
  async loadJSON() { return (await fetch(this.url)).json(); }
};

globalThis.Notification = class {
  setTriggerDate(d) { this.triggerDate = d; this.nextTriggerDate = d; }
  async schedule() {
    if (this.triggerDate) pending.set(this.identifier, this); // no trigger date = delivered now
    else delivered.push(this);
  }
  static async allPending() { return [...pending.values()]; }
  static async removePending(ids) { ids.forEach(id => pending.delete(id)); }
};

module.exports = { delivered, pending };
