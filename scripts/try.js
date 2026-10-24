// Run sweep.js from the terminal against the live SF API and print what Shortcuts would get.
//   npm run try -- park lat=37.7549 lon=-122.41448
//   npm run try -- confirm "choice=Folsom St, Near 22nd St, West side"
//   npm run try -- clear
//   npm run try                      (status)
// Saved state lives in .sweep-state/ so park -> confirm -> status works across runs.
const path = require("path");

process.env.SWEEP_STATE_DIR ??= path.join(__dirname, "..", ".sweep-state");
const { delivered, pending } = require("../test/scriptable-mock");
const { run } = require("../src/sweep");

const [mode, ...pairs] = process.argv.slice(2);
const input = Object.fromEntries(pairs.map(p => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]));
if (mode) input.mode = mode;

run(input).then(
  out => {
    console.log(JSON.stringify(out, null, 2));
    for (const n of [...delivered, ...pending.values()]) {
      const when = n.triggerDate ? n.triggerDate.toLocaleString("en-US") : "now";
      console.log(`🔔 ${when} · ${n.title} · ${n.subtitle} · ${n.body}`);
    }
  },
  e => { console.error(`Error: ${e.message}`); process.exit(1); }
);
