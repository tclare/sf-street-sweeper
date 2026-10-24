// Sweep: SF street-sweeping reminders for a parked car.
// A Scriptable module: scriptable/Sweep.js downloads this file and calls run(input), where
// input is the dictionary passed from Shortcuts' "Run Script" action:
//   {mode: "park", lat, lon}  -> {best, prompt, labels}   (no "best" = outside SF / no sweeping nearby)
//   {mode: "confirm", choice} -> {alarm?}                 (alarm is "yyyy-MM-dd HH:mm" for Create Alarm)
//   {mode: "nightly"}         -> {alarm?}
//   {mode: "clear"}           -> {}
// An optional "now" (ISO string) overrides the clock for testing.

const API = "https://data.sf.gov/resource/yhqp-riqs.json";
const SEARCH_METERS = 90;
const NOTIFY_HOUR = 21; // reminder at 9pm the night before
const ALARM_LEAD_MIN = 30;
const REMINDER_ID = "sweep-reminder";
const DAYS = ["Sun", "Mon", "Tues", "Wed", "Thu", "Fri", "Sat"]; // dataset spelling

const fm = FileManager.local();
const STATE_PATH = fm.joinPath(fm.documentsDirectory(), "sweep-state.json");

let now;

async function run(raw) {
  const input = normalizeInput(raw);
  now = input.now ? new Date(input.now) : new Date();
  switch (input.mode) {
    case "park": return park(Number(input.lat), Number(input.lon));
    case "confirm": return confirm(input.choice);
    case "nightly": return nightly();
    case "clear": await clear(); return {};
    default:
      throw new Error(
        `Unknown mode: ${input.mode}. Received ${describe(raw)}. ` +
        "Run this from Shortcuts with a Dictionary (mode = park, confirm, nightly or clear) " +
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
  await clear();
  const cands = await candidates(lat, lon);
  if (!cands.length) return { labels: [] };
  saveState({ pending: Object.fromEntries(cands.map(c => [c.label, c])) });
  const best = cands[0];
  return {
    best: best.label,
    prompt: `📍 ${best.short}\nBlock: ${best.block}`,
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
  const next = nextSweep(rules, now);
  if (!next) {
    await clear();
    await notify("No Street Sweeping Found", spot.short, "No reminders set for this spot.");
    return {};
  }
  const state = { label: spot.short, block: spot.block, rules, ...next };
  saveState(state);
  await scheduleReminder(state);
  await notify("Parking Confirmed", spot.short, `Next sweeping ${fmtWindow(state)}.`);
  return alarmOutput(state);
}

async function nightly() {
  const state = loadState();
  if (!state?.rules) return {};
  if (new Date(state.end) <= now) { // car stayed put past a sweep: roll forward
    const next = nextSweep(state.rules, now);
    if (!next) { await clear(); return {}; }
    Object.assign(state, next);
    delete state.alarmFor;
    saveState(state);
    await scheduleReminder(state);
  }
  return alarmOutput(state);
}

async function clear() {
  await Notification.removePending([REMINDER_ID]);
  if (fm.fileExists(STATE_PATH)) fm.remove(STATE_PATH);
}

// ---- location -> candidate spots ----

async function candidates(lat, lon) {
  const pt = `'POINT(${lon} ${lat})'`;
  const rows = await soql({
    $select: `distinct cnn,corridor,limits,cnnrightleft,blockside,line,distance_in_meters(line,${pt}) as dist`,
    $where: `distance_in_meters(line,${pt}) < ${SEARCH_METERS} AND weekday!='Holiday'`,
    $order: "dist",
    $limit: "10",
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
    const short = `${r.corridor}, Near ${near}, ${r.blockside} side`;
    return {
      cnn: r.cnn, side: r.cnnrightleft, short, block: `${a} – ${b}`,
      label: `${short} (toward ${far})`, guessed: r.cnnrightleft === guess,
    };
  });
  // Rows come nearest-first in L/R pairs; lead with the nearest block on the geometric side.
  const best = out.findIndex(c => c.guessed);
  if (best > 0) out.unshift(...out.splice(best, 1));
  return out;
}

// ---- schedule ----

// weekN = the Nth occurrence of that weekday in the month (days 1-7 = week1, ...).
function nextSweep(rules, from) {
  for (let i = 0; i < 36; i++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const nth = Math.ceil(day.getDate() / 7);
    const windows = rules
      .filter(r => r.weekday === DAYS[day.getDay()] && r[`week${nth}`] === "1")
      .map(r => ({ start: atHour(day, r.fromhour), end: atHour(day, r.tohour) }))
      .filter(w => w.end > from)
      .sort((p, q) => p.start - q.start);
    if (windows.length) return { start: windows[0].start.toISOString(), end: windows[0].end.toISOString() };
  }
  return null;
}

const atHour = (day, h) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(h));

function scheduleReminder(state) {
  const start = new Date(state.start);
  const at = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1, NOTIFY_HOUR);
  const n = new Notification();
  n.identifier = REMINDER_ID; // same id replaces any pending reminder
  n.title = "Car Move Reminder";
  n.subtitle = `Located at ${state.label}`;
  n.body = `Street sweeping ${fmtWindow(state)}.`;
  n.sound = "default";
  if (at > now) n.setTriggerDate(at); // otherwise 9pm has passed: deliver now
  return n.schedule();
}

// Create Alarm only takes a time of day, so hand one back only when it will ring within 24h.
function alarmOutput(state) {
  const alarmAt = new Date(new Date(state.start) - ALARM_LEAD_MIN * 60e3);
  const ahead = alarmAt - now;
  if (ahead <= 0 || ahead > 24 * 3600e3 || state.alarmFor === state.start) return {};
  state.alarmFor = state.start;
  saveState(state);
  const p = n => String(n).padStart(2, "0");
  return {
    alarm: `${alarmAt.getFullYear()}-${p(alarmAt.getMonth() + 1)}-${p(alarmAt.getDate())} ${p(alarmAt.getHours())}:${p(alarmAt.getMinutes())}`,
  };
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

module.exports = { run, nextSweep };
