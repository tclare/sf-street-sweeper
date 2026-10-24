// End-to-end scenarios against the live SF Open Data API. Skip with SKIP_LIVE=1.
const { delivered, pending } = require("./scriptable-mock");
const test = require("node:test");
const assert = require("node:assert");
const { run } = require("../src/sweep");

const opts = { skip: process.env.SKIP_LIVE === "1" && "SKIP_LIVE=1" };
const FOLSOM = { lat: 37.7549, lon: -122.41448 }; // west side of Folsom, between 22nd and 23rd
const WEST = "Folsom St, Near 22nd St, West side";

test("park suggests the west side of Folsom first", opts, async () => {
  const out = await run({ mode: "park", ...FOLSOM, now: "2026-10-24T14:00:00-07:00" });
  assert.equal(out.best, WEST);
  assert.equal(out.labels[0], WEST);
  assert.equal(out.prompt, `📍 ${WEST}`);
});

test("park offers up to 10 distinct options, including the block's far end", opts, async () => {
  const { labels } = await run({ mode: "park", ...FOLSOM, now: "2026-10-24T14:00:00-07:00" });
  assert.ok(labels.length <= 10);
  assert.equal(new Set(labels).size, labels.length);
  assert.ok(labels.includes("Folsom St, Near 23rd St, West side"));
  assert.ok(labels.every(l => /^.+, Near .+, (North|South|East|West|NorthEast|NorthWest|SouthEast|SouthWest) side$/.test(l)), labels);
});

test("confirm schedules the 9pm reminder for the night before", opts, async () => {
  const out = await run({ mode: "confirm", choice: WEST, now: "2026-10-24T14:00:00-07:00" });
  assert.deepEqual(out, {}); // alarm is more than 24h away
  const r = pending.get("sweep-reminder");
  assert.equal(r.title, "Car Move Reminder");
  assert.equal(r.subtitle, "Located at Folsom St, Near 22nd St, West side");
  assert.equal(r.triggerDate.getTime(), new Date("2026-10-25T21:00:00-07:00").getTime());
  assert.equal(delivered.at(-1).title, "Parking Confirmed");
});

test("nightly hands back the alarm once, the night before", opts, async () => {
  assert.deepEqual(await run({ mode: "nightly", now: "2026-10-24T21:00:00-07:00" }), {});
  assert.deepEqual(await run({ mode: "nightly", now: "2026-10-25T21:00:00-07:00" }), { alarm: "2026-10-26 08:30" });
  assert.deepEqual(await run({ mode: "nightly", now: "2026-10-25T21:00:10-07:00" }), {});
});

test("nightly rolls forward if the car stays past a sweep", opts, async () => {
  await run({ mode: "nightly", now: "2026-10-26T21:00:00-07:00" });
  const r = pending.get("sweep-reminder");
  assert.equal(r.triggerDate.getTime(), new Date("2026-10-27T21:00:00-07:00").getTime());
});

test("parking after 9pm the night before alerts now and returns the alarm", opts, async () => {
  await run({ mode: "park", ...FOLSOM, now: "2026-10-25T22:30:00-07:00" });
  const out = await run({ mode: "confirm", choice: WEST, now: "2026-10-25T22:30:00-07:00" });
  assert.deepEqual(out, { alarm: "2026-10-26 08:30" });
  assert.equal(pending.get("sweep-reminder").triggerDate, undefined); // delivered immediately
});

test("outside SF returns no candidates and clears everything", opts, async () => {
  const out = await run({ mode: "park", lat: 37.8044, lon: -122.2711 }); // Oakland
  assert.deepEqual(out, { labels: [] });
  assert.equal(pending.size, 0);
  assert.deepEqual(await run({ mode: "nightly" }), {});
});

test("no input shows read-only status with the version", opts, async () => {
  const { VERSION } = require("../src/sweep");
  const out = await run({});
  assert.equal(out.version, VERSION);
  assert.deepEqual(out.status, [
    "Parked: no saved spot",
    "Reminder: none",
    "SF API: OK (test spot: Folsom St, Near 22nd St, West side)",
  ]);
});
