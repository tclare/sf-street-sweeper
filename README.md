# 🧹 sf-street-sweeper

**Never get a San Francisco street-sweeping ticket again.** When you park, your iPhone works out which block and which side of the street you're on, looks up that side's sweeping schedule, and reminds you to move the car at 9 PM the night before. It also sets an alarm for 30 minutes before sweeping starts.

| When | What you see |
|---|---|
| 🚗 You park (Sat 2:00 PM) | **Confirm Parking Location**<br>📍 Folsom St, Near 22nd St, West side · Block: 22nd St – 23rd St<br>✅ Confirm · ✏️ Pick another · 🚫 Not now |
| 🌙 Night before (Sun 9:00 PM) | **Car Move Reminder**<br>Located at Folsom St, Near 22nd St, West side<br>Street sweeping Mon, Oct 26, 9:00 AM–11:00 AM. |
| ⏰ 30 min before (Mon 8:30 AM) | Alarm: *Move car – street sweeping* |

Built with **Apple Shortcuts** for the triggers, menus and alarms, **[Scriptable](https://scriptable.app)** for the logic, and SF's **[Street Sweeping Schedule](https://data.sf.gov/d/yhqp-riqs)** open data.

---

## How it works

```mermaid
sequenceDiagram
    participant Car as 🚗 CarPlay / Bluetooth
    participant SC as Shortcuts
    participant L as Scriptable: Sweep (loader)
    participant GH as GitHub (main)
    participant SF as data.sf.gov

    Car->>SC: disconnects
    SC->>L: {mode: park, lat, lon}
    L->>GH: fetch src/sweep.js (cached fallback)
    L->>SF: blocks within 90 m, nearest first
    L-->>SC: best guess + other candidates
    SC->>SC: Confirm / Pick another
    SC->>L: {mode: confirm, choice}
    L->>SF: schedule for that block side
    L->>L: schedule 9 PM reminder
    Note over SC,L: every night at 9 PM
    SC->>L: {mode: nightly}
    L-->>SC: alarm time (if sweeping is within 24 h)
    SC->>SC: Create Alarm
```

- **Which block:** one Socrata query using `distance_in_meters()` returns the nearest block sides, already sorted.
- **Which side:** a cross product of your position against the block's centreline gives left/right, which maps to the dataset's `cnnrightleft`. The `blockside` field gives the compass label (North, West, …).
- **Which cross street:** where your position falls along the block (`limits` is listed in the line's drawn direction) gives the nearer end.
- **When:** `weekN` means the Nth occurrence of that weekday in the month. The script searches the next 36 days for the first window that hasn't ended.
- **Cancelling:** parking again, or reconnecting to the car, clears the saved spot, the pending reminder and the alarms. Outside SF the API returns nothing, so nothing is set.

> **About GPS accuracy:** phone GPS is usually off by 5–15 m, about half a street's width. The street and cross street are reliable; the side is a best guess. That's why you're asked to confirm.

---

## Setup

### 1. Publish this repo
Push it to GitHub. The phone fetches `src/sweep.js` anonymously, so the repo needs to be **public** (see [Private repos](#private-repos) otherwise).

### 2. Install the loader in Scriptable
1. Install [Scriptable](https://apps.apple.com/app/scriptable/id1405459188) on your iPhone.
2. Create a script named **`Sweep`** and paste in [`scriptable/Sweep.js`](scriptable/Sweep.js).
3. `REPO` at the top is set to `tclare/sf-street-sweeper`. Change it if you fork this repo.

That's the only code that lives on the phone. Everything else comes from `main`.

### 3. Build the Shortcuts
In each **Run Script** action, choose script *Sweep* and leave **Run In App** off.

<details open>
<summary><b>Sweep · Clear</b></summary>

1. **Run Script** · Parameter: **Dictionary** `mode = clear`
2. **Get All Alarms** → **Repeat with Each** → **If** *Repeat Item › Label* contains `Move car` → **Toggle Alarm** *Repeat Item* **Off**
</details>

<details open>
<summary><b>Confirm Parking Location</b> (iOS titles the menu notification with this name)</summary>

1. **Run Shortcut** `Sweep · Clear`
2. **Get Current Location**
3. **Run Script** · Parameter: **Dictionary** `mode = park`, `lat = Current Location › Latitude`, `lon = Current Location › Longitude`
4. **If** *Script Result › best* does not have any value → **Stop This Shortcut**
5. **Choose from Menu** · Prompt: *Script Result › prompt*
   - **✅ Confirm**: **Text** *Script Result › best* → **Set Variable** `Choice`
   - **✏️ Pick another**: **Choose from List** *Script Result › labels* → **Set Variable** `Choice`
   - **🚫 Not now**: **Stop This Shortcut**
6. **Run Script** · Parameter: **Dictionary** `mode = confirm`, `choice = Choice`
7. **If** *Script Result › alarm* has any value → **Get Dates from Input** → **Create Alarm** at that time, label `Move car – street sweeping`
</details>

<details open>
<summary><b>Sweep · Nightly</b></summary>

1. **Run Script** · Parameter: **Dictionary** `mode = nightly`
2. The same **If → Get Dates from Input → Create Alarm** as step 7 above
</details>

### 4. Add the automations (on the iPhone)
Shortcuts › Automation › **+**. Choose **Run Immediately** for each and turn off *Notify When Run*.

| Trigger | Runs |
|---|---|
| CarPlay **Disconnects** (or Bluetooth › *your car* › Disconnects) | `Confirm Parking Location` |
| CarPlay **Connects** | `Sweep · Clear` |
| Time of Day **9:00 PM**, Daily | `Sweep · Nightly` |

Allow Shortcuts location access as **Always**.

---

## Script interface

`src/sweep.js` exports `run(input)`. The Shortcuts parameter dictionary is passed straight through.

| `mode` | Input | Returns |
|---|---|---|
| `park` | `lat`, `lon` | `{best, prompt, labels}`, or `{labels: []}` outside SF |
| `confirm` | `choice` (one of `labels`) | `{alarm?: "yyyy-MM-dd HH:mm"}` |
| `nightly` | — | `{alarm?}`: only when the alarm is due within 24 h, and only once per sweep |
| `clear` | — | `{}` |

Pass `now` (an ISO date) to pretend it's another time. This works in the Shortcuts Dictionary too, which is handy for testing on the phone. Tuning constants (`SEARCH_METERS`, `NOTIFY_HOUR`, `ALARM_LEAD_MIN`) are at the top of the file.

The parameter can also be JSON text or a bare mode name (`nightly`), and keys are matched case-insensitively. Input with no recognisable `mode` gives an error that shows what the script received.

**No input** (tapping ▶︎ in Scriptable) opens a read-only status screen: the version, your saved spot and next sweep, whether a reminder is pending, and a live check of the SF API.

---

## Development

```sh
npm test               # all tests (offline schedule maths, loader fallback, live API scenarios)
npm run test:offline   # skip the tests that call data.sf.gov
```

Node 18+ is required; there are no dependencies. The tests run the real script against small stand-ins for Scriptable's `Request`, `Notification` and `FileManager` ([`test/scriptable-mock.js`](test/scriptable-mock.js)). They use `America/Los_Angeles` time so DST is covered.

### Shipping a change
Your phone runs **whatever is on `main`**. Commit, then push:

```sh
npm test && git push
```

- The loader fetches a fresh copy on every run, bypassing GitHub's cache.
- **Checking a deploy:** bump `VERSION` at the top of `src/sweep.js`, push, then tap ▶︎ on *Sweep* in Scriptable. The title should show the new version.
- **A broken push doesn't break your phone.** If the download fails, isn't HTTP 200, or doesn't load, the loader uses the last good copy. The same happens when you're offline.
- CI ([`.github/workflows/test.yml`](.github/workflows/test.yml)) runs the tests on every push, and weekly to catch changes to the SF dataset.
- **Pinning:** to stop the phone tracking `main`, set `REF` in the loader to a tag (`v1.0.0`) or commit SHA. Then release with `git tag v1.1.0 && git push --tags` and update `REF`.

### Private repos
`raw.githubusercontent.com` needs a token for private repos. Create a fine-grained token with read-only *Contents* access to this repo. Store it once in Scriptable with `Keychain.set("github-token", "...")`, then add this to the loader's request:

```js
req.headers = { Authorization: `token ${Keychain.get("github-token")}` };
```

---

## Known limitations

- **Holidays aren't checked.** You may get a reminder on a holiday when sweeping is suspended, which errs on the safe side.
- **Disabled alarms pile up.** Shortcuts can only switch alarms off, not delete them, so used ones collect in the Clock app.
- **Data quirks.** A few SF records have truncated street names (`ission Bay Cir`) or leading zeros (`04th St`).
- **Maps' Parked Car pin isn't used.** Shortcuts can't read it. The automation uses the same CarPlay/Bluetooth disconnect signal Maps relies on, plus your current location.

## Data

[Street Sweeping Schedule](https://data.sf.gov/d/yhqp-riqs) · San Francisco Public Works / SFMTA, via DataSF (`data.sf.gov`; the old `data.sfgov.org` host redirects there).
