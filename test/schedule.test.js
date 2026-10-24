// Offline tests for the next-sweep calculation.
require("./scriptable-mock");
const test = require("node:test");
const assert = require("node:assert");
const { upcomingSweeps } = require("../src/sweep");

const rule = (weekday, fromhour, tohour, weeks = "11111") => ({
  weekday, fromhour, tohour, ...Object.fromEntries([...weeks].map((w, i) => [`week${i + 1}`, w])),
});
const mwf = ["Mon", "Wed", "Fri"].map(d => rule(d, "9", "11"));
const startOf = (rules, now) => upcomingSweeps(rules, new Date(now))[0]?.start.toISOString();
const at = iso => new Date(iso).toISOString();

test("next weekday window", () => {
  assert.equal(startOf(mwf, "2026-10-24T14:00:00-07:00"), at("2026-10-26T09:00:00-07:00"));
});

test("a window in progress counts as next", () => {
  assert.equal(startOf(mwf, "2026-10-26T10:00:00-07:00"), at("2026-10-26T09:00:00-07:00"));
});

test("a finished window rolls to the next day", () => {
  assert.equal(startOf(mwf, "2026-10-26T11:00:00-07:00"), at("2026-10-28T09:00:00-07:00"));
});

test("1st/3rd/5th week skips the 4th Tuesday and crosses DST", () => {
  const tue = [rule("Tues", "13", "15", "10101")];
  assert.equal(startOf(tue, "2026-10-24T14:00:00-07:00"), at("2026-11-03T13:00:00-08:00"));
});

test("earliest of two windows on the same day", () => {
  const two = [rule("Mon", "12", "14"), rule("Mon", "6", "8")];
  assert.equal(startOf(two, "2026-10-24T14:00:00-07:00"), at("2026-10-26T06:00:00-07:00"));
});

test("lists every sweep in the next 36 days, one per day", () => {
  const sweeps = upcomingSweeps([...mwf, rule("Mon", "6", "8")], new Date("2026-10-24T14:00:00-07:00"));
  assert.equal(sweeps.length, 15); // Mon/Wed/Fri from Oct 26 through Nov 27
  assert.equal(sweeps[0].start.toISOString(), at("2026-10-26T06:00:00-07:00")); // earlier Monday window wins
  assert.ok(sweeps.every((w, i) => i === 0 || w.start > sweeps[i - 1].start));
});

test("no rules means no sweeps", () => {
  assert.deepEqual(upcomingSweeps([], new Date()), []);
});
