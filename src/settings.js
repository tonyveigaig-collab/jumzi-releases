// Desktop preferences kept in <userData>/settings.json.
const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  /** Closing the window keeps JUMZI running in the tray / menu bar (like Teams and Slack). */
  runInBackground: true,
  /** Start JUMZI when the computer starts (off until the person turns it on). */
  openAtLogin: false,
  /** Shown once: "JUMZI is still running" after the first close to the tray. */
  backgroundHintShown: false,
};

let cache = null;
const file = () => path.join(app.getPath("userData"), "settings.json");

function get() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), "utf8")) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function set(patch) {
  cache = { ...get(), ...patch };
  try {
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch {
    /* read-only profile */
  }
  return cache;
}

module.exports = { get, set };
