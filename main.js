// JUMZI desktop: the office in its own window, like Zoom, Teams or Slack.
// - Loads the production site, so web and desktop always run the same version of JUMZI, with the same
//   account, data and features; the shell around it updates itself from GitHub Releases.
// - Camera, microphone, screen sharing with a native picker, notifications and OS permission prompts.
// - Keeps running in the tray / menu bar when the window is closed; optional start with the computer.
// - jumzi:// links open offices, rooms, meetings and invitations directly in the app.
// - Diagnostics window, local logs and crash dumps, anonymous health reports.
const { app, BrowserWindow, Menu, Tray, desktopCapturer, dialog, ipcMain, nativeImage, nativeTheme, screen, session, shell, systemPreferences } = require("electron");
const path = require("path");
const fs = require("fs");
const log = require("./src/log");
const settings = require("./src/settings");
const autostart = require("./src/autostart");
const deeplink = require("./src/deeplink");
const updater = require("./src/updater");
const diagnostics = require("./src/diagnostics");

const APP_URL = (process.env.JUMZI_URL || "https://jumzi.vercel.app").replace(/\/$/, "");
const ORIGIN = new URL(APP_URL).origin;
const START = `${APP_URL}/dashboard`;
const SMOKE = process.argv.includes("--smoke-test");
const DOWNLOADS = `${APP_URL}/download`;

// Keep audio and video running while the window is minimised, hidden in the tray or behind others.
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
let pendingLink = deeplink.fromArgv(process.argv);
app.isQuitting = false;

const asset = (name) => path.join(__dirname, "assets", name);
const isOurs = (url) => {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
};
const safeExternal = (url) => {
  try {
    const u = new URL(url);
    if (["https:", "http:", "mailto:"].includes(u.protocol)) void shell.openExternal(u.toString());
  } catch {
    /* not a URL */
  }
};

/** How this copy was installed: decides how it updates. */
function installType() {
  if (!app.isPackaged) return "dev";
  if (process.platform === "darwin") return "dmg";
  if (process.platform === "win32") return fs.existsSync(path.join(path.dirname(process.execPath), "Uninstall JUMZI.exe")) ? "nsis" : "msi";
  if (process.env.APPIMAGE) return "appimage";
  try {
    return fs.readFileSync(path.join(process.resourcesPath, "package-type"), "utf8").trim() || "linux";
  } catch {
    return "linux";
  }
}

// ---------------------------------------------------------------- window -------------------------------

const stateFile = () => path.join(app.getPath("userData"), "window.json");

function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    const area = screen.getDisplayMatching(b).workArea;
    if (b.width >= 900 && b.height >= 600 && b.x >= area.x - 50 && b.y >= area.y - 50) return b;
  } catch {
    /* first run */
  }
  return { width: 1360, height: 860 };
}

function saveBounds() {
  if (!win || win.isMinimized()) return;
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch {
    /* read-only profile */
  }
}

function createWindow({ show = true } = {}) {
  const bounds = loadBounds();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    title: "JUMZI",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111114" : "#f5f5f7",
    autoHideMenuBar: true,
    show: false,
    icon: asset("icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload-app.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      backgroundThrottling: false,
      spellcheck: true,
    },
  });
  if (bounds.maximized) win.maximize();
  win.once("ready-to-show", () => show && !SMOKE && win?.show());
  win.on("close", (e) => {
    saveBounds();
    // Closing keeps JUMZI running in the tray (calls and notifications keep working), unless quitting.
    if (!app.isQuitting && settings.get().runInBackground && !SMOKE) {
      e.preventDefault();
      win?.hide();
      if (!settings.get().backgroundHintShown && tray) {
        settings.set({ backgroundHintShown: true });
        showBackgroundHint();
      }
    }
  });
  win.on("closed", () => (win = null));
  diagnostics.watchWindow(win);

  // The site can tell it runs inside the desktop app (hides the "install the app" prompts).
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} JumziDesktop/${app.getVersion()}`);

  win.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (code === -3 || !isMainFrame) return; // aborted by a redirect, or a sub-frame
    log.warn("load_failed", { code, desc });
    win?.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offlinePage(isOurs(url) ? url : START))}`);
  });

  void win.loadURL(pendingLink ? (deeplink.toAppUrl(pendingLink, APP_URL) ?? START) : START);
  pendingLink = null;
}

function showWindow() {
  if (!win) createWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function offlinePage(retry) {
  return `<!doctype html><meta charset="utf-8"><title>JUMZI</title>
  <body style="margin:0;height:100vh;display:grid;place-items:center;font:15px system-ui;background:#f5f5f7;color:#111114">
  <div style="text-align:center"><h1 style="font-size:22px">Sem conexão</h1>
  <p style="color:#6e6e73">Verifique a internet e tente de novo.</p>
  <button onclick="location.href='${retry.replace(/'/g, "")}'" style="margin-top:8px;border:0;border-radius:12px;padding:10px 18px;min-height:44px;background:#111114;color:#fff;font:600 14px system-ui;cursor:pointer">Tentar de novo</button></div></body>`;
}

function showBackgroundHint() {
  const body = process.platform === "darwin" ? "O JUMZI continua aberto na barra de menus." : "O JUMZI continua rodando na bandeja do sistema. Para sair, use o menu do ícone.";
  try {
    const { Notification } = require("electron");
    if (Notification.isSupported()) new Notification({ title: "JUMZI continua aberto", body, silent: true }).show();
  } catch {
    /* notifications unavailable */
  }
}

// ---------------------------------------------------------------- deep links ---------------------------

function openLink(link) {
  const url = deeplink.toAppUrl(link, APP_URL);
  log.info("deeplink", { ok: !!url });
  if (!url) return;
  if (!win) {
    pendingLink = link;
    if (app.isReady()) createWindow();
    return;
  }
  void win.loadURL(url);
  showWindow();
}

// macOS delivers links through open-url (also before the app is ready).
app.on("open-url", (e, link) => {
  e.preventDefault();
  if (app.isReady()) openLink(link);
  else pendingLink = link;
});

// Windows and Linux start a second copy with the link in its arguments: hand it to this one.
app.on("second-instance", (_e, argv) => {
  const link = deeplink.fromArgv(argv);
  if (link) openLink(link);
  else showWindow();
});

function registerProtocol() {
  // Installers register jumzi:// too; this keeps it pointing at this copy (and works in development).
  if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(deeplink.PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  else app.setAsDefaultProtocolClient(deeplink.PROTOCOL);
}

// ---------------------------------------------------------------- security -----------------------------

app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (e) => e.preventDefault());
  // Links to other sites open in the normal browser; our own pages stay in the app.
  contents.setWindowOpenHandler(({ url }) => {
    if (isOurs(url)) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } } };
    safeExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (e, url) => {
    if (isOurs(url) || url.startsWith("https://accounts.google.com/") || url.startsWith("data:text/html")) return;
    e.preventDefault();
    safeExternal(url);
  });
});

// ---------------------------------------------------------------- permissions --------------------------

const ALLOWED = new Set(["media", "display-capture", "notifications", "fullscreen", "clipboard-sanitized-write", "clipboard-read", "speaker-selection", "wake-lock", "screen-wake-lock"]);

/** On macOS the system asks once per app for camera and microphone; ask when the site first needs them. */
async function osMediaAccess(mediaTypes) {
  if (process.platform !== "darwin") return true;
  const kinds = (mediaTypes || []).map((t) => (t === "video" ? "camera" : t === "audio" ? "microphone" : null)).filter(Boolean);
  for (const k of kinds) {
    if (systemPreferences.getMediaAccessStatus(k) === "granted") continue;
    if (!(await systemPreferences.askForMediaAccess(k))) {
      settingsHelp(k);
      return false;
    }
  }
  return true;
}

function settingsHelp(kind) {
  const label = { camera: "a câmera", microphone: "o microfone", screen: "a gravação de tela" }[kind];
  const panes = {
    darwin: { camera: "Privacy_Camera", microphone: "Privacy_Microphone", screen: "Privacy_ScreenCapture" },
    win32: { camera: "ms-settings:privacy-webcam", microphone: "ms-settings:privacy-microphone", screen: null },
  };
  const target = process.platform === "darwin" ? `x-apple.systempreferences:com.apple.preference.security?${panes.darwin[kind]}` : panes.win32?.[kind];
  void dialog
    .showMessageBox(win ?? undefined, {
      type: "warning",
      message: `O JUMZI não tem permissão para usar ${label}`,
      detail: "Libere o JUMZI nas configurações de privacidade do sistema e tente de novo.",
      buttons: target ? ["Abrir configurações", "Agora não"] : ["Ok"],
    })
    .then((r) => {
      if (target && r.response === 0) void shell.openExternal(target);
    });
}

function setupPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const ok = isOurs(details.requestingUrl || wc.getURL()) && ALLOWED.has(permission);
    if (!ok) return callback(false);
    if (permission === "media") return void osMediaAccess(details.mediaTypes).then(callback);
    callback(true);
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => isOurs(origin) && ALLOWED.has(permission));

  // Screen sharing: our own picker of screens and windows.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!isOurs(request.securityOrigin || request.frame?.url || "")) return callback({});
    if (process.platform === "darwin" && systemPreferences.getMediaAccessStatus("screen") === "denied") {
      settingsHelp("screen");
      return callback({});
    }
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
      // The site draws the picker itself when it can (no separate window, which some graphics drivers
      // painted all black); the native picker window stays as the fallback.
      const page = win && !win.isDestroyed() ? win.webContents : null;
      const choice = page && pickerPages.has(page.id) ? await pickInPage(page, sources) : await pickSource(sources);
      const source = sources.find((s) => s.id === choice);
      if (!source) return callback({});
      // System audio is only available when sharing a whole screen on Windows.
      callback(source.id.startsWith("screen:") && process.platform === "win32" ? { video: source, audio: "loopback" } : { video: source });
    } catch (e) {
      log.warn("screen_share_failed", { message: String(e && e.message).slice(0, 200) });
      callback({});
    }
  });
}

/** Pages (webContents ids) that draw the screen picker themselves (see preload-app.js). */
const pickerPages = new Set();
ipcMain.on("desktop:picker-ready", (e) => {
  const wc = e.sender;
  if (pickerPages.has(wc.id)) return;
  pickerPages.add(wc.id);
  // A reload or a new page has to announce itself again.
  const forget = () => pickerPages.delete(wc.id);
  wc.once("did-start-navigation", forget);
  wc.once("destroyed", forget);
});
ipcMain.on("desktop:picker-gone", (e) => pickerPages.delete(e.sender.id));

/** Asks the page to show its own picker. Resolves with the chosen source id (null: cancelled). */
function pickInPage(page, sources) {
  return new Promise((resolve) => {
    const reqId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let timer = null;
    const done = (choice) => {
      ipcMain.removeListener("desktop:pick-screen-result", onResult);
      clearTimeout(timer);
      resolve(typeof choice === "string" && sources.some((s) => s.id === choice) ? choice : null);
    };
    const onResult = (e, id, choice) => {
      if (e.sender !== page || id !== reqId) return;
      done(choice);
    };
    ipcMain.on("desktop:pick-screen-result", onResult);
    timer = setTimeout(() => done(null), 3 * 60 * 1000);
    page.send(
      "desktop:pick-screen",
      reqId,
      sources.map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL(), screen: s.id.startsWith("screen:") })),
    );
  });
}

/** Window listing screens and windows with thumbnails. Resolves with the chosen source id. */
function pickSource(sources) {
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      parent: win ?? undefined,
      // Not modal and shown only once painted: modal windows came up all black on some graphics drivers.
      show: false,
      width: 760,
      height: 560,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: "Apresentar",
      autoHideMenuBar: true,
      backgroundColor: "#1c1c1e",
      webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
    });
    let done = false;
    const finish = (id) => {
      if (done) return;
      done = true;
      ipcMain.removeHandler("picker:sources");
      ipcMain.removeAllListeners("picker:choose");
      if (!picker.isDestroyed()) picker.close();
      resolve(id);
    };
    ipcMain.handle("picker:sources", () => sources.map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL(), screen: s.id.startsWith("screen:") })));
    ipcMain.on("picker:choose", (_e, id) => finish(typeof id === "string" ? id : null));
    picker.on("closed", () => finish(null));
    picker.once("ready-to-show", () => {
      picker.show();
      picker.focus();
    });
    void picker.loadFile(path.join(__dirname, "picker.html"));
  });
}

// ---------------------------------------------------------------- bridge with the site ----------------

const fromSite = (e) => isOurs(e.senderFrame?.url || "");
let badgeCount = 0;

function setBadge(count) {
  badgeCount = count;
  if (process.platform === "darwin") app.dock?.setBadge(count ? String(count) : "");
  else if (process.platform === "linux") app.setBadgeCount(count);
  else if (win) win.setOverlayIcon(count ? nativeImage.createFromPath(asset("badge.png")) : null, count ? `${count} mensagens não lidas` : "");
  tray?.setToolTip(count ? `JUMZI · ${count} não lidas` : "JUMZI");
}

function setupBridge() {
  ipcMain.on("desktop:info", (e) => (e.returnValue = { version: app.getVersion(), platform: process.platform, arch: process.arch }));
  ipcMain.on("desktop:badge", (e, n) => fromSite(e) && setBadge(Number(n) || 0));
  ipcMain.on("desktop:focus", (e) => fromSite(e) && showWindow());
  ipcMain.on("desktop:attention", (e) => {
    if (!fromSite(e) || !win || win.isFocused()) return;
    if (process.platform === "darwin") app.dock?.bounce("informational");
    else win.flashFrame(true);
  });
  ipcMain.on("desktop:diagnostics", (e) => fromSite(e) && diagnostics.open(win));
  ipcMain.on("desktop:check-updates", (e) => fromSite(e) && void updater.check({ manual: true }));
  ipcMain.handle("desktop:settings", (e) => (fromSite(e) ? { ...settings.get(), openAtLogin: autostart.isEnabled() } : null));
  ipcMain.handle("desktop:set-setting", (e, key, value) => {
    if (!fromSite(e)) return null;
    applySetting(key, value);
    return { ...settings.get(), openAtLogin: autostart.isEnabled() };
  });
}

function applySetting(key, value) {
  if (key === "openAtLogin") {
    settings.set({ openAtLogin: value });
    autostart.apply(value);
  } else if (key === "runInBackground") settings.set({ runInBackground: value });
  buildTray();
  buildMenu();
}

// ---------------------------------------------------------------- tray and menus -----------------------

function trayImage() {
  if (process.platform === "darwin") {
    const img = nativeImage.createFromPath(asset("trayTemplate.png"));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(asset(process.platform === "win32" ? "tray-win.png" : "tray.png"));
}

function trayMenu() {
  const s = settings.get();
  const u = updater.getState();
  return Menu.buildFromTemplate([
    { label: "Abrir JUMZI", click: showWindow },
    { type: "separator" },
    { label: "Iniciar com o computador", type: "checkbox", checked: autostart.isEnabled(), click: (i) => applySetting("openAtLogin", i.checked) },
    { label: "Continuar aberto ao fechar a janela", type: "checkbox", checked: s.runInBackground, click: (i) => applySetting("runInBackground", i.checked) },
    { type: "separator" },
    u.status === "ready" ? { label: `Reiniciar para atualizar (${u.version})`, click: () => updater.installNow() } : { label: "Verificar atualizações", click: () => void updater.check({ manual: true }) },
    { label: "Diagnóstico", click: () => diagnostics.open(win) },
    { type: "separator" },
    { label: "Sair do JUMZI", click: quit },
  ]);
}

function buildTray() {
  if (SMOKE) return;
  if (!tray) {
    tray = new Tray(trayImage());
    tray.setToolTip("JUMZI");
    tray.on("click", () => (process.platform === "darwin" ? tray?.popUpContextMenu(trayMenu()) : showWindow()));
  }
  // macOS shows the menu on click (above); Windows and Linux on right click.
  if (process.platform !== "darwin") tray.setContextMenu(trayMenu());
}

function buildMenu() {
  const mac = process.platform === "darwin";
  const u = updater.getState();
  const update = u.status === "ready" ? { label: `Reiniciar para atualizar (${u.version})`, click: () => updater.installNow() } : { label: "Verificar atualizações…", click: () => void updater.check({ manual: true }) };
  const template = [
    ...(mac
      ? [
          {
            label: "JUMZI",
            submenu: [
              { role: "about", label: "Sobre o JUMZI" },
              update,
              { type: "separator" },
              { label: "Iniciar com o computador", type: "checkbox", checked: autostart.isEnabled(), click: (i) => applySetting("openAtLogin", i.checked) },
              { type: "separator" },
              { role: "hide", label: "Ocultar JUMZI" },
              { role: "hideOthers", label: "Ocultar outros" },
              { role: "unhide", label: "Mostrar tudo" },
              { type: "separator" },
              { label: "Sair do JUMZI", accelerator: "Cmd+Q", click: quit },
            ],
          },
        ]
      : [{ label: "Arquivo", submenu: [update, { type: "separator" }, { label: "Sair do JUMZI", accelerator: "Ctrl+Q", click: quit }] }]),
    {
      label: "Editar",
      submenu: [
        { role: "undo", label: "Desfazer" },
        { role: "redo", label: "Refazer" },
        { type: "separator" },
        { role: "cut", label: "Recortar" },
        { role: "copy", label: "Copiar" },
        { role: "paste", label: "Colar" },
        { role: "selectAll", label: "Selecionar tudo" },
      ],
    },
    {
      label: "Exibir",
      submenu: [
        { role: "reload", label: "Recarregar" },
        { role: "resetZoom", label: "Tamanho real" },
        { role: "zoomIn", label: "Aumentar" },
        { role: "zoomOut", label: "Diminuir" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Tela cheia" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }]),
      ],
    },
    { label: "Janela", submenu: [{ role: "minimize", label: "Minimizar" }, { role: "zoom", label: "Zoom" }, ...(mac ? [{ role: "front", label: "Trazer tudo para frente" }] : [])] },
    {
      label: "Ajuda",
      submenu: [
        { label: "Diagnóstico", click: () => diagnostics.open(win) },
        { label: "Abrir pasta de registros", click: () => void shell.openPath(log.logDir()) },
        { label: "Central de downloads", click: () => void shell.openExternal(DOWNLOADS) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function quit() {
  app.isQuitting = true;
  app.quit();
}

// ---------------------------------------------------------------- smoke test (CI) ----------------------

/** Started by CI after installing a package: load the site, check the bridge and links, then exit. */
async function smokeTest() {
  const out = (process.argv.find((a) => a.startsWith("--smoke-out=")) || "").slice("--smoke-out=".length);
  const result = { version: app.getVersion(), platform: process.platform, arch: process.arch, installType: installType(), checks: {} };
  const done = (ok) => {
    result.ok = ok;
    const text = JSON.stringify(result, null, 2);
    process.stdout.write(`${text}\n`);
    if (out) fs.writeFileSync(out, text);
    app.exit(ok ? 0 : 1);
  };
  const timer = setTimeout(() => {
    result.checks.timeout = true;
    done(false);
  }, 90_000);
  try {
    result.checks.deeplink =
      deeplink.toAppUrl("jumzi://w/abc123?room=r1&evil=x", APP_URL) === `${APP_URL}/w/abc123?room=r1` && deeplink.toAppUrl("jumzi://../../etc/passwd", APP_URL) === null && deeplink.toAppUrl("https://evil.example/w/a", APP_URL) === null;
    result.checks.updaterLoads = !!require("electron-updater").autoUpdater;
    result.checks.assets = ["icon.png", "tray.png", "tray-win.png", "trayTemplate.png", "badge.png"].every((f) => fs.existsSync(asset(f)));
    createWindow({ show: false });
    await new Promise((resolve, reject) => {
      win.webContents.once("did-finish-load", resolve);
      win.webContents.once("did-fail-load", (_e, code, desc, _url, main) => main && code !== -3 && reject(new Error(`${code} ${desc}`)));
    });
    result.checks.loadedUrl = win.webContents.getURL();
    result.checks.title = await win.webContents.executeJavaScript("document.title");
    result.checks.bridge = await win.webContents.executeJavaScript("typeof window.jumziDesktop === 'object' && window.jumziDesktop.version");
    result.checks.userAgent = (await win.webContents.executeJavaScript("navigator.userAgent")).includes("JumziDesktop/");
    result.checks.webgl = await win.webContents.executeJavaScript("!!document.createElement('canvas').getContext('webgl2')");
    result.checks.gpu = app.getGPUFeatureStatus().webgl;
    clearTimeout(timer);
    const c = result.checks;
    done(c.deeplink && c.updaterLoads && c.assets && /JUMZI/i.test(c.title) && c.bridge === app.getVersion() && c.userAgent && isOurs(c.loadedUrl));
  } catch (e) {
    result.error = String(e && e.message);
    clearTimeout(timer);
    done(false);
  }
}

// ---------------------------------------------------------------- start --------------------------------

app.whenReady().then(() => {
  app.setAppUserModelId("app.jumzi.desktop");
  log.info("start", { version: app.getVersion(), platform: process.platform, arch: process.arch, installType: installType(), smoke: SMOKE });
  setupPermissions();
  setupBridge();
  diagnostics.setup({ appUrl: APP_URL, installType: installType(), updaterState: () => updater.getState() });
  if (SMOKE) return void smokeTest();

  registerProtocol();
  if (settings.get().openAtLogin !== autostart.isEnabled()) autostart.apply(settings.get().openAtLogin);
  buildMenu();
  buildTray();
  createWindow({ show: !autostart.startedHidden() });
  updater.start({
    type: installType(),
    onState: (s) => {
      buildTray();
      buildMenu();
      win?.webContents.send("desktop:update", s);
      if (s.status === "error") void diagnostics.report("update_error", { reason: s.error });
    },
  });
  app.on("activate", () => showWindow());
});

app.on("before-quit", () => {
  app.isQuitting = true;
  saveBounds();
});

app.on("window-all-closed", () => {
  // With the tray, JUMZI keeps running; without background mode, closing the window quits (not on macOS).
  if (process.platform !== "darwin" && !settings.get().runInBackground) app.quit();
});
