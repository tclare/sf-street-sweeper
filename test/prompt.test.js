// Offline tests for the "Car Park Detected" notification and the in-app confirm menu.
const { delivered, pending, alerts, alertAnswers } = require("./scriptable-mock");
const test = require("node:test");
const assert = require("node:assert");
const { run } = require("../src/sweep");

// A stand-in SF API: two blocks near the point, each swept Mon 9-11am every week.
const BLOCKS = [
  { cnn: "1", corridor: "Folsom St", limits: "22nd St - 23rd St", cnnrightleft: "R", blockside: "West", line: { coordinates: [[-122.4146, 37.7545], [-122.4146, 37.7555]] } },
  { cnn: "1", corridor: "Folsom St", limits: "22nd St - 23rd St", cnnrightleft: "L", blockside: "East", line: { coordinates: [[-122.4146, 37.7545], [-122.4146, 37.7555]] } },
];
const RULES = [{ weekday: "Mon", fromhour: "9", tohour: "11", week1: "1", week2: "1", week3: "1", week4: "1", week5: "1" }];
globalThis.Request = class {
  constructor(url) { this.url = decodeURIComponent(url); }
  async loadJSON() { return this.url.includes("$order") ? BLOCKS : RULES; }
};

const SAT = "2026-10-24T14:00:00-07:00";
const HERE = { lat: 37.7549, lon: -122.41448 }; // right of the line as drawn
const WEST = "Folsom St, Near 22nd St, West side";
const EAST = "Folsom St, Near 22nd St, East side";
const prompt = () => delivered.find(n => n.identifier === "sweep-park-prompt");
const park = () => run({ mode: "park", ...HERE, now: SAT });

test("park sends a Car Park Detected notification that opens the menu", async () => {
  const out = await park();
  assert.equal(out.best, WEST);
  const n = prompt();
  assert.equal(n.title, `Car Park Detected at ${WEST}`);
  assert.equal(n.subtitle, "Tap to confirm or change");
  assert.equal(n.scriptName, "Sweep");
  assert.deepEqual(n.userInfo, { mode: "choose" });
  assert.deepEqual(n.actions.map(a => a.title), ["✅ Confirm", "✏️ Change"]);
  assert.equal(n.actions[0].url, `scriptable:///run/Sweep?mode=confirm&choice=${encodeURIComponent(WEST)}`);
});

test("tapping the notification runs choose; Confirm takes the best guess", async () => {
  await park();
  globalThis.args = { shortcutParameter: null, plainTexts: [], queryParameters: {}, notification: { userInfo: { mode: "choose" } } };
  alertAnswers.push(0);
  try {
    const out = await run({}); // what the loader passes on a tap
    assert.equal(out.spot, WEST);
    assert.equal(alerts.at(-1).message, `📍 ${WEST}`);
  } finally {
    delete globalThis.args;
  }
  assert.ok(!prompt(), "the prompt is cleared once answered");
  assert.equal(delivered.at(-1).title, "Parking Confirmed");
  assert.equal(pending.size, 1);
});

test("Pick another lists every candidate", async () => {
  await park();
  alertAnswers.push(1, 1);
  const out = await run({ mode: "choose", now: SAT });
  assert.equal(out.spot, EAST);
  assert.deepEqual(alerts.at(-1).actions.slice(0, 2), [WEST, EAST]); // then each block's far end
});

test("Not now leaves the spot unconfirmed", async () => {
  await park();
  alertAnswers.push(-1);
  assert.deepEqual(await run({ mode: "choose", now: SAT }), {});
  assert.equal(pending.size, 0);
  assert.match((await run({ mode: "status" })).text, /^Parked: waiting for you to confirm a spot/);
});

test("the notification's Confirm action confirms without the menu", async () => {
  await park();
  const shown = alerts.length;
  globalThis.args = { queryParameters: { mode: "confirm", choice: WEST } };
  try {
    assert.equal((await run({})).spot, WEST);
  } finally {
    delete globalThis.args;
  }
  assert.equal(alerts.length, shown);
});

test("clear removes an unanswered prompt", async () => {
  await park();
  assert.ok(prompt());
  await run({ mode: "clear" });
  assert.ok(!prompt());
  await assert.rejects(run({ mode: "choose" }), /No parked spot is waiting/);
});
