// Automatic updates from the public jumzi-releases repository (GitHub Releases).
// Windows (NSIS) and Linux (AppImage, .deb, .rpm) update themselves: the new version downloads in the
// background and installs when JUMZI restarts. On macOS the system only accepts updates for a signed app;
// an unsigned build (or any failure) falls back to telling the person a new version is ready to download.
const { app, dialog, Notification, shell } = require("electron");
const log = require("./log");

const CHECK_EVERY = 4 * 60 * 60 * 1000;
const DOWNLOAD_PAGE = "https://jumzi.vercel.app/download";

let autoUpdater = null;
let state = { status: "idle", version: null, error: null };
let onChange = () => {};
let installedType = null; // "msi" | "nsis" | "deb" | "rpm" | "appimage" | "dmg" | …

function load() {
  if (autoUpdater) return autoUpdater;
  ({ autoUpdater } = require("electron-updater"));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: (m) => log.info("updater", { m: String(m) }), warn: (m) => log.warn("updater", { m: String(m) }), error: (m) => log.error("updater", { m: String(m) }), debug: () => {} };
  // Windows ARM gets its own update file, so it never receives the x64 build.
  if (process.platform === "win32" && process.arch === "arm64") {
    autoUpdater.channel = "latest-arm64";
    autoUpdater.allowDowngrade = false;
  }
  autoUpdater.on("checking-for-update", () => set({ status: "checking", error: null }));
  autoUpdater.on("update-not-available", () => set({ status: "current" }));
  autoUpdater.on("update-available", (i) => set({ status: "downloading", version: i.version }));
  autoUpdater.on("update-downloaded", (i) => {
    set({ status: "ready", version: i.version });
    notify(`JUMZI ${i.version} está pronto`, "A nova versão entra quando você reiniciar o JUMZI.", () => installNow());
  });
  autoUpdater.on("error", (e) => {
    log.warn("update_error", { message: String(e && e.message).slice(0, 300) });
    set({ status: "error", error: String(e && e.message).slice(0, 200) });
  });
  return autoUpdater;
}

function set(patch) {
  state = { ...state, ...patch };
  onChange(state);
}

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  if (onClick) n.on("click", onClick);
  n.show();
}

/** MSI installs are managed by IT (Intune, GPO): they update through a new MSI, not by themselves. */
function canSelfUpdate() {
  if (!app.isPackaged) return false;
  if (installedType === "msi") return false;
  if (process.platform === "linux" && !process.env.APPIMAGE && installedType !== "deb" && installedType !== "rpm") return false;
  return true;
}

async function check({ manual = false } = {}) {
  if (!canSelfUpdate()) {
    if (manual) {
      const r = await dialog.showMessageBox({
        type: "info",
        message: "Atualizações deste JUMZI",
        detail: installedType === "msi" ? "Esta instalação (MSI) é atualizada pelo administrador do computador. Para atualizar você mesmo, baixe a nova versão." : "Baixe a versão mais recente na central de downloads.",
        buttons: ["Abrir central de downloads", "Fechar"],
      });
      if (r.response === 0) void shell.openExternal(DOWNLOAD_PAGE);
    }
    return;
  }
  try {
    const u = load();
    const result = await u.checkForUpdates();
    if (manual && state.status === "current") await dialog.showMessageBox({ type: "info", message: "O JUMZI está atualizado", detail: `Versão ${app.getVersion()}.` });
    return result;
  } catch (e) {
    log.warn("update_check_failed", { message: String(e && e.message).slice(0, 300) });
    if (process.platform === "darwin" || manual) {
      // macOS without a signed build, or no network: point to the download page.
      const latest = await latestVersion().catch(() => null);
      if (latest && newer(latest, app.getVersion())) {
        set({ status: "manual", version: latest });
        notify(`JUMZI ${latest} disponível`, "Clique para baixar a nova versão.", () => void shell.openExternal(DOWNLOAD_PAGE));
      } else if (manual) await dialog.showMessageBox({ type: "warning", message: "Não foi possível verificar atualizações", detail: "Confira a internet e tente de novo." });
    }
  }
}

/** Version of the latest public release (used when the system updater is not available). */
async function latestVersion() {
  const r = await fetch("https://api.github.com/repos/tonyveigaig-collab/jumzi-releases/releases/latest", { headers: { accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error(`github ${r.status}`);
  const j = await r.json();
  return String(j.tag_name || "").replace(/^v/, "");
}

function newer(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function installNow() {
  if (state.status !== "ready") return;
  log.info("update_install", { version: state.version });
  app.isQuitting = true;
  load().quitAndInstall(false, true);
}

function start({ type, onState }) {
  installedType = type;
  onChange = onState || onChange;
  setTimeout(() => void check(), 15_000);
  setInterval(() => void check(), CHECK_EVERY).unref?.();
}

module.exports = { start, check, installNow, getState: () => state, newer };
