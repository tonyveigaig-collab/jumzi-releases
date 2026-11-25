// Optional start with the computer. Windows and macOS use the system login items; Linux uses an
// XDG autostart entry (~/.config/autostart/jumzi.desktop). JUMZI starts hidden in the tray.
const { app } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const log = require("./log");

const HIDDEN_ARG = "--hidden";
const linuxFile = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "autostart", "jumzi.desktop");

/** The command that starts this install (AppImage runs from a mounted path: use its real file). */
function linuxExec() {
  const bin = process.env.APPIMAGE || process.execPath;
  return `"${bin.replace(/"/g, '\\"')}" ${HIDDEN_ARG}`;
}

function apply(enabled) {
  try {
    if (process.platform === "linux") {
      const f = linuxFile();
      if (enabled) {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(
          f,
          ["[Desktop Entry]", "Type=Application", "Name=JUMZI", `Exec=${linuxExec()}`, "Icon=jumzi", "X-GNOME-Autostart-enabled=true", "Terminal=false", ""].join("\n"),
        );
      } else if (fs.existsSync(f)) fs.unlinkSync(f);
    } else {
      app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true, args: [HIDDEN_ARG] });
    }
    log.info("autostart", { enabled });
  } catch (e) {
    log.warn("autostart_failed", { message: String(e && e.message) });
  }
}

function isEnabled() {
  if (process.platform === "linux") return fs.existsSync(linuxFile());
  return app.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin;
}

/** Started by the login item: stay in the tray instead of opening the window. */
const startedHidden = () => process.argv.includes(HIDDEN_ARG) || app.getLoginItemSettings().wasOpenedAsHidden;

module.exports = { apply, isEnabled, startedHidden };
