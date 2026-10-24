// Sweep: SF street-sweeping reminders for a parked car.
// A Scriptable module: scriptable/Sweep.js downloads this file and calls run(input), where
// input is the dictionary passed from Shortcuts' "Run Script" action:
//   {mode: "park", lat, lon}  -> {best, prompt, labels}   (no "best" = outside SF / no sweeping nearby)
//   {mode: "confirm", choice} -> {spot, next, reminder}   (schedules a 9pm reminder before the next sweep)
//   {mode: "clear"}           -> {}                       (cancels the reminder, forgets the spot)
//   {mode: "status"}          -> {text}                   (N/A lines when nothing is being tracked)
// No input (e.g. the ▶︎ button in Scriptable) shows a read-only status screen instead.
// An optional "now" (ISO string) overrides the clock for testing.

const VERSION = "2.3.0"; // bump when you push; ▶︎ in Scriptable shows which version ran
const API = "https://data.sf.gov/resource/yhqp-riqs.json";
const SEARCH_METERS = 90;
const MAX_OPTIONS = 10; // distinct spots offered in the pick-another list
const NOTIFY_HOUR = 21; // reminder at 9pm the night before
const LOOKAHEAD_DAYS = 36; // how far ahead to look for the next sweep
const REMINDER_ID = "sweep-reminder"; // v2.0-2.1 used sweep-reminder-N; clear() removes those too
const DAYS = ["Sun", "Mon", "Tues", "Wed", "Thu", "Fri", "Sat"]; // dataset spelling

const fm = FileManager.local();
const STATE_PATH = fm.joinPath(fm.documentsDirectory(), "sweep-state.json");

let now;

async function run(raw) {
  const input = normalizeInput(raw);
  now = input.now ? new Date(input.now) : new Date();
  if (!Object.keys(input).length) return status();
  switch (input.mode) {
    case "park": return park(Number(input.lat), Number(input.lon));
    case "confirm": return confirm(input.choice);
    case "clear": await clear(); return {};
    case "status": return { text: (await tracking()).join("\n") };
    default:
      throw new Error(
        `Unknown mode: ${input.mode}. Received ${describe(raw)}. ` +
        "Run this from Shortcuts with a Dictionary (mode = park, confirm, clear or status) " +
        "in Run Script's Parameter field."
      );
  }
}

// Shortcuts may pass a Dictionary, JSON text or a bare mode name, in Parameter or Texts;
// Scriptable's own Run button passes nothing. Keys are matched case-insensitively.
function normalizeInput(raw) {
  const empty = v => v == null || v === "" || (typeof v === "object" && !Object.keys(v).length);
  let v = raw;
  if (empty(v) && typeof args !== "undefined") {
    v = [args.shortcutParameter, args.plainTexts?.[0], args.queryParameters].find(x => !empty(x));
  }
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { v = { mode: v }; }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const input = Object.fromEntries(
    Object.entries(v).map(([k, val]) => [k.trim().toLowerCase(), typeof val === "string" ? val.trim() : val])
  );
  if (typeof input.mode === "string") input.mode = input.mode.toLowerCase();
  return input;
}

function describe(raw) {
  if (raw == null || (typeof raw === "object" && !Object.keys(raw).length)) return "no input";
  const s = typeof raw === "string" ? `text "${raw}"` : JSON.stringify(raw);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

// ---- modes ----

async function park(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("park needs numeric lat and lon (check the Dictionary in Run Script)");
  }
  await clear();
  const cands = await candidates(lat, lon);
  if (!cands.length) return { labels: [] };
  saveState({ pending: Object.fromEntries(cands.map(c => [c.label, c])) });
  const best = cands[0];
  return {
    best: best.label,
    prompt: `📍 ${best.label}`,
    labels: cands.map(c => c.label),
  };
}

async function confirm(choice) {
  const spot = (loadState()?.pending || {})[choice];
  if (!spot) throw new Error(`Unknown choice: ${choice}`);
  const rules = await soql({
    $select: "weekday,fromhour,tohour,week1,week2,week3,week4,week5",
    $where: `cnn='${spot.cnn}' AND cnnrightleft='${spot.side}' AND weekday!='Holiday'`,
  });
  const [next] = upcomingSweeps(rules, now);
  if (!next) {
    await clear();
    await notify("No Street Sweeping Found", spot.label, "No reminders set for this spot.");
    return {};
  }
  const at = await scheduleReminder(spot.label, next);
  saveState({ label: spot.label, rules, reminderFor: next.start.toISOString(), reminderAt: at?.toISOString() });
  await notify("Parking Confirmed", spot.label, `Next sweeping ${fmtWindow(next)}.`);
  return { spot: spot.label, next: fmtWindow(next), reminder: at ? fmtDateTime(at) : "sent now" };
}

async function clear() {
  const ids = (await Notification.allPending()).map(n => n.identifier).filter(id => id?.startsWith(REMINDER_ID));
  await Notification.removePending(ids);
  if (fm.fileExists(STATE_PATH)) fm.remove(STATE_PATH);
}

// Read-only: what's saved, what's scheduled, and whether the SF API answers.
async function status() {
  const lines = await tracking();
  try {
    const [best] = await candidates(37.7549, -122.41448); // Folsom St test point
    lines.push(`SF API: OK (test spot: ${best?.label ?? "no result"})`);
  } catch (e) {
    lines.push(`SF API: failed (${e.message || e})`);
  }

  if (typeof config !== "undefined" && config.runsInApp) {
    const alert = new Alert();
    alert.title = `Street Sweeper v${VERSION}`;
    alert.message = lines.join("\n");
    alert.addAction("OK");
    await alert.present();
  }
  return { version: VERSION, status: lines };
}

// The saved spot, its next sweep and its reminder, as "Label: value" lines.
async function tracking() {
  const state = loadState();
  if (!state?.rules) {
    return [`Parked: ${state?.pending ? "waiting for you to confirm a spot" : "N/A"}`, "Next sweeping: N/A", "Reminder: N/A"];
  }
  const [next] = upcomingSweeps(state.rules, now);
  const lines = [`Parked: ${state.label}`, `Next sweeping: ${next ? fmtWindow(next) : "none in the next 5 weeks"}`];

  const pending = (await Notification.allPending()).find(n => n.identifier === REMINDER_ID);
  let reminder = "none"; // e.g. the car stayed put past the sweep it was reminded about
  if (pending) reminder = fmtDateTime(pending.nextTriggerDate ?? state.reminderAt);
  else if (next && state.reminderFor === next.start.toISOString()) reminder = "sent";
  lines.push(`Reminder: ${reminder}`);
  return lines;
}

// ---- location -> candidate spots ----

async function candidates(lat, lon) {
  const pt = `'POINT(${lon} ${lat})'`;
  const rows = await soql({
    $select: `distinct cnn,corridor,limits,cnnrightleft,blockside,line,distance_in_meters(line,${pt}) as dist`,
    $where: `distance_in_meters(line,${pt}) < ${SEARCH_METERS} AND weekday!='Holiday'`,
    $order: "dist",
    $limit: String(MAX_OPTIONS * 4), // headroom: blocks either side of a corner share a label
  });
  const k = Math.cos(lat * Math.PI / 180); // scale longitude so distances are roughly isotropic
  const out = rows.filter(r => r.line).map(r => {
    const c = r.line.coordinates;
    const [x1, y1] = c[0], [x2, y2] = c[c.length - 1];
    const dx = (x2 - x1) * k, dy = y2 - y1, px = (lon - x1) * k, py = lat - y1;
    // Left/right of the line's drawn direction, which is what cnnrightleft refers to.
    const guess = dx * py - dy * px > 0 ? "L" : "R";
    // 0 at the first street in "limits", 1 at the second (limits follow line direction).
    const t = (dx * px + dy * py) / (dx * dx + dy * dy);
    const [a, b = a] = r.limits.split(/\s+-\s+/);
    const [near, far] = t < 0.5 ? [a, b] : [b, a];
    const spot = cross => ({ cnn: r.cnn, side: r.cnnrightleft, label: `${r.corridor}, Near ${cross}, ${r.blockside} side` });
    return { ...spot(near), guessed: r.cnnrightleft === guess, other: far !== near && spot(far) };
  });
  // Rows come nearest-first in L/R pairs; lead with the nearest block on the geometric side.
  const best = out.findIndex(c => c.guessed);
  if (best > 0) out.unshift(...out.splice(best, 1));
  // Then each block's far end, in case GPS is off along the block. A label shared by
  // two blocks (either side of a corner) keeps the nearer block.
  const seen = new Set();
  return [...out, ...out.map(c => c.other).filter(Boolean)]
    .filter(c => !seen.has(c.label) && seen.add(c.label))
    .map(({ cnn, side, label }) => ({ cnn, side, label }))
    .slice(0, MAX_OPTIONS);
}

// ---- schedule ----

// Sweeps that haven't ended yet, soonest first, at most one per day (the earliest window).
// weekN = the Nth occurrence of that weekday in the month (days 1-7 = week1, ...).
function upcomingSweeps(rules, from, days = LOOKAHEAD_DAYS) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const nth = Math.ceil(day.getDate() / 7);
    const [first] = rules
      .filter(r => r.weekday === DAYS[day.getDay()] && r[`week${nth}`] === "1")
      .map(r => ({ start: atHour(day, r.fromhour), end: atHour(day, r.tohour) }))
      .filter(w => w.end > from)
      .sort((p, q) => p.start - q.start);
    if (first) out.push(first);
  }
  return out;
}

const atHour = (day, h) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(h));

// Returns when the reminder will fire, or null if 9pm has passed and it was sent now.
async function scheduleReminder(label, sweep) {
  const { start } = sweep;
  const at = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1, NOTIFY_HOUR);
  const n = new Notification();
  n.identifier = REMINDER_ID;
  n.title = "Car Move Reminder";
  n.subtitle = `Located at ${label}`;
  n.body = `Street sweeping ${fmtWindow(sweep)}.`;
  n.sound = "default";
  if (at > now) n.setTriggerDate(at); // otherwise 9pm has passed: deliver now
  await n.schedule();
  return at > now ? at : null;
}

// ---- helpers ----

async function soql(params) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const res = await new Request(`${API}?${qs}`).loadJSON();
  if (!Array.isArray(res)) throw new Error(`SF API: ${res?.message || JSON.stringify(res)}`);
  return res;
}

function fmtWindow({ start, end }) {
  const s = new Date(start), e = new Date(end);
  const day = s.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const time = d => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day}, ${time(s)}–${time(e)}`;
}

const fmtDateTime = d =>
  new Date(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function notify(title, subtitle, body) {
  const n = new Notification();
  n.title = title;
  n.subtitle = subtitle;
  n.body = body;
  return n.schedule();
}

function loadState() {
  return fm.fileExists(STATE_PATH) ? JSON.parse(fm.readString(STATE_PATH)) : null;
}

function saveState(s) {
  fm.writeString(STATE_PATH, JSON.stringify(s));
}

module.exports = { run, upcomingSweeps, VERSION };
