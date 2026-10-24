// Offline tests for the next-sweep calculation.
require("./scriptable-mock");
const test = require("node:test");
const assert = require("node:assert");
const { nextSweep } = require("../src/sweep");

const rule = (weekday, fromhour, tohour, weeks = "11111") => ({
  weekday, fromhour, tohour, ...Object.fromEntries([...weeks].map((w, i) => [`week${i + 1}`, w])),
});
const mwf = ["Mon", "Wed", "Fri"].map(d => rule(d, "9", "11"));
const startOf = (rules, now) => nextSweep(rules, new Date(now))?.start;
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

test("no rules means no sweep", () => {
  assert.equal(nextSweep([], new Date()), null);
});
