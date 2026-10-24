// Sweep loader: the only script installed in Scriptable (name it "Sweep").
// Downloads src/sweep.js from GitHub, falls back to the last good copy when offline
// or when the new version fails to load, then runs it with the Shortcuts parameter.

const REPO = "YOUR_GITHUB_USER/street-sweeper";
const REF = "main"; // branch, tag or commit SHA
const URL = `https://raw.githubusercontent.com/${REPO}/${REF}/src/sweep.js`;

const fm = FileManager.local();
const dir = fm.documentsDirectory();
const libPath = fm.joinPath(dir, "sweep-lib.js");
const nextPath = fm.joinPath(dir, "sweep-lib.next.js");

async function loadLib() {
  try {
    const req = new Request(`${URL}?t=${Date.now()}`); // query string skips GitHub's CDN cache
    req.timeoutInterval = 5;
    const src = await req.loadString();
    if (req.response.statusCode !== 200) throw new Error(`HTTP ${req.response.statusCode}`);
    fm.writeString(nextPath, src);
    const lib = importModule(nextPath); // throws on a broken push, keeping the cached copy
    if (typeof lib.run !== "function") throw new Error("sweep.js does not export run()");
    if (fm.fileExists(libPath)) fm.remove(libPath);
    fm.move(nextPath, libPath);
    return lib;
  } catch (e) {
    console.warn(`Using cached sweep.js: ${e.message || e}`);
    if (!fm.fileExists(libPath)) throw new Error(`No cached sweep.js and download failed: ${e.message || e}`);
    return importModule(libPath);
  }
}

try {
  const lib = await loadLib();
  Script.setShortcutOutput(await lib.run(args.shortcutParameter || {}));
} catch (e) {
  const n = new Notification();
  n.title = "Street Sweeping Error";
  n.body = String(e.message || e);
  await n.schedule();
  Script.setShortcutOutput({ error: String(e.message || e) });
} finally {
  Script.complete();
}
