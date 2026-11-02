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
  actions = [];
  addAction(title, url) { this.actions.push({ title, url }); }
  setTriggerDate(d) { this.triggerDate = d; this.nextTriggerDate = d; }
  async schedule() {
    if (this.triggerDate) pending.set(this.identifier, this); // no trigger date = delivered now
    else delivered.push(this);
  }
  static async allPending() { return [...pending.values()]; }
  static async removePending(ids) { ids.forEach(id => pending.delete(id)); }
  static async removeDelivered(ids) {
    for (let i = delivered.length - 1; i >= 0; i--) if (ids.includes(delivered[i].identifier)) delivered.splice(i, 1);
  }
};

// Alerts answer with the next index queued in alertAnswers (-1 = cancel) and are recorded in alerts.
const alerts = [];
const alertAnswers = [];
globalThis.Alert = class {
  actions = [];
  addAction(t) { this.actions.push(t); }
  addCancelAction(t) { this.cancel = t; }
  async presentAlert() { alerts.push(this); return alertAnswers.shift() ?? -1; }
  async presentSheet() { return this.presentAlert(); }
};

module.exports = { delivered, pending, alerts, alertAnswers };
