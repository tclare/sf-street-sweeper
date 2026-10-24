// End-to-end scenarios against the live SF Open Data API. Skip with SKIP_LIVE=1.
const { delivered, pending } = require("./scriptable-mock");
const test = require("node:test");
const assert = require("node:assert");
const { run, VERSION } = require("../src/sweep");

const opts = { skip: process.env.SKIP_LIVE === "1" && "SKIP_LIVE=1" };
const FOLSOM = { lat: 37.7549, lon: -122.41448 }; // west side of Folsom, between 22nd and 23rd
const WEST = "Folsom St, Near 22nd St, West side"; // swept Mon/Wed/Fri 9-11am, every week
const SAT = "2026-10-24T14:00:00-07:00";
const reminders = () => [...pending.values()].sort((p, q) => p.identifier.localeCompare(q.identifier, "en", { numeric: true }));
const nineOnEve = iso => { const d = new Date(iso); d.setDate(d.getDate() - 1); d.setHours(21, 0, 0, 0); return d.getTime(); };

test("park suggests the west side of Folsom first", opts, async () => {
  const out = await run({ mode: "park", ...FOLSOM, now: SAT });
  assert.equal(out.best, WEST);
  assert.equal(out.labels[0], WEST);
  assert.equal(out.prompt, `📍 ${WEST}`);
});

test("park offers up to 10 distinct options, including the block's far end", opts, async () => {
  const { labels } = await run({ mode: "park", ...FOLSOM, now: SAT });
  assert.ok(labels.length <= 10);
  assert.equal(new Set(labels).size, labels.length);
  assert.ok(labels.includes("Folsom St, Near 23rd St, West side"));
  assert.ok(labels.every(l => /^.+, Near .+, (North|South|East|West|NorthEast|NorthWest|SouthEast|SouthWest) side$/.test(l)), labels);
});

test("confirm schedules one 9pm reminder, the night before the next sweep", opts, async () => {
  const out = await run({ mode: "confirm", choice: WEST, now: SAT });
  assert.deepEqual(out, { spot: WEST, next: "Mon, Oct 26, 9:00 AM–11:00 AM", reminder: "Sun, Oct 25, 9:00 PM" });
  assert.equal(pending.size, 1);
  const r = pending.get("sweep-reminder");
  assert.equal(r.title, "Car Move Reminder");
  assert.equal(r.subtitle, `Located at ${WEST}`);
  assert.equal(r.triggerDate.getTime(), new Date("2026-10-25T21:00:00-07:00").getTime());
  assert.equal(delivered.at(-1).title, "Parking Confirmed");
});

test("status mode reports the tracked spot as text", opts, async () => {
  const { text } = await run({ mode: "status", now: SAT });
  assert.equal(text, [
    `Parked: ${WEST}`,
    "Next sweeping: Mon, Oct 26, 9:00 AM–11:00 AM",
    "Reminder: Sun, Oct 25, 9:00 PM",
  ].join("\n"));
});

test("parking after 9pm the night before sends the reminder now", opts, async () => {
  const late = "2026-10-25T22:30:00-07:00";
  await run({ mode: "park", ...FOLSOM, now: late });
  assert.equal(pending.size, 0); // park cancels the previous spot's reminder
  const out = await run({ mode: "confirm", choice: WEST, now: late });
  assert.equal(out.reminder, "sent now");
  assert.equal(pending.size, 0);
  assert.match(delivered.find(n => n.title === "Car Move Reminder").body, /Mon, Oct 26/);
  assert.match((await run({ mode: "status", now: late })).text, /Reminder: sent$/);
});

test("status shows no reminder once the car stays past the reminded sweep", opts, async () => {
  const { text } = await run({ mode: "status", now: "2026-10-26T12:00:00-07:00" });
  assert.match(text, /Next sweeping: Wed, Oct 28.*\nReminder: none$/s);
});

test("clear cancels the reminder", opts, async () => {
  await run({ mode: "park", ...FOLSOM, now: SAT });
  await run({ mode: "confirm", choice: WEST, now: SAT });
  assert.equal(pending.size, 1);
  assert.deepEqual(await run({ mode: "clear" }), {});
  assert.equal(pending.size, 0);
});

test("outside SF returns no candidates and leaves nothing scheduled", opts, async () => {
  await run({ mode: "park", ...FOLSOM, now: SAT });
  await run({ mode: "confirm", choice: WEST, now: SAT });
  const out = await run({ mode: "park", lat: 37.8044, lon: -122.2711 }); // Oakland
  assert.deepEqual(out, { labels: [] });
  assert.equal(pending.size, 0);
  assert.deepEqual(await run({ mode: "status" }), { text: "Parked: N/A\nNext sweeping: N/A\nReminder: N/A" });
});

test("status mode says when a spot awaits confirmation", opts, async () => {
  await run({ mode: "park", ...FOLSOM, now: SAT });
  assert.match((await run({ mode: "status" })).text, /^Parked: waiting for you to confirm a spot\nNext sweeping: N\/A/);
  await run({ mode: "clear" });
});

test("no input shows read-only status with the version", opts, async () => {
  const out = await run({});
  assert.equal(out.version, VERSION);
  assert.deepEqual(out.status, [
    "Parked: N/A",
    "Next sweeping: N/A",
    "Reminder: N/A",
    `SF API: OK (test spot: ${WEST})`,
  ]);
});
