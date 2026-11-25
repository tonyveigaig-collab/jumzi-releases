// Small file logger: <userData>/logs/main.log, rotated at 2 MB (one previous file kept as main.old.log).
// Lines are JSON so they can be read by people and by tools. Never log tokens, cookies or message text.
const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const MAX = 2 * 1024 * 1024;
let file = null;

function logDir() {
  return path.join(app.getPath("userData"), "logs");
}

function open() {
  if (file) return file;
  fs.mkdirSync(logDir(), { recursive: true });
  file = path.join(logDir(), "main.log");
  return file;
}

function write(level, event, data) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...data }) + "\n";
  try {
    const f = open();
    try {
      if (fs.statSync(f).size > MAX) fs.renameSync(f, path.join(logDir(), "main.old.log"));
    } catch {
      /* first line */
    }
    fs.appendFileSync(f, line);
  } catch {
    /* read-only profile: keep going without a log */
  }
  if (!app.isPackaged) process.stdout.write(line);
}

/** Last lines of the log, for the diagnostics report. */
function tail(lines = 80) {
  try {
    return fs.readFileSync(open(), "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

module.exports = {
  info: (event, data = {}) => write("info", event, data),
  warn: (event, data = {}) => write("warn", event, data),
  error: (event, data = {}) => write("error", event, data),
  logDir,
  tail,
};
