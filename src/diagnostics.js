// Error diagnostics and performance monitoring.
// - Native crash dumps are kept locally (crashReporter, no upload).
// - Crashes, frozen windows and update failures are logged and sent as an anonymous report.
// - Every 15 minutes a CPU / memory sample is logged; one sample an hour is reported.
// - "Diagnóstico" window: versions, system, GPU, permissions, connection checks, recent log, with
//   copy / open logs / send to support.
const { app, BrowserWindow, clipboard, crashReporter, ipcMain, shell, systemPreferences } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const log = require("./log");

let ctx = { appUrl: "", installType: "unknown", updaterState: () => ({}) };
let lastPerfReport = 0;

function base() {
  return {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    osVersion: `${os.type()} ${os.release()}`.slice(0, 60),
    installType: ctx.installType,
    electron: process.versions.electron,
  };
}

/** Anonymous report to the JUMZI server (fire and forget). */
async function report(kind, extra = {}) {
  try {
    await fetch(`${ctx.appUrl}/api/desktop/diag`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...base(), kind, ...extra }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* offline: the local log still has it */
  }
}

function perfSample() {
  const metrics = app.getAppMetrics();
  const cpuPercent = Math.round(metrics.reduce((a, m) => a + (m.cpu?.percentCPUUsage || 0), 0) * 10) / 10;
  const memoryMB = Math.round(metrics.reduce((a, m) => a + (m.memory?.workingSetSize || 0), 0) / 1024);
  return { cpuPercent, memoryMB, uptimeMin: Math.round(process.uptime() / 60), processes: metrics.length };
}

function gpuStatus() {
  try {
    const s = app.getGPUFeatureStatus();
    return { webgl: s.webgl, webgl2: s.webgl2, rasterization: s.rasterization, video_decode: s.video_decode };
  } catch {
    return {};
  }
}

function mediaAccess() {
  if (process.platform === "linux") return { camera: "sistema", microphone: "sistema", screen: "sistema" };
  try {
    return {
      camera: systemPreferences.getMediaAccessStatus("camera"),
      microphone: systemPreferences.getMediaAccessStatus("microphone"),
      screen: process.platform === "darwin" ? systemPreferences.getMediaAccessStatus("screen") : "granted",
    };
  } catch {
    return {};
  }
}

async function connectivity() {
  const probe = async (url) => {
    const t = Date.now();
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
      return `${r.ok ? "ok" : `HTTP ${r.status}`} (${Date.now() - t} ms)`;
    } catch (e) {
      return `falhou: ${String(e && e.message).slice(0, 80)}`;
    }
  };
  const [site, api] = await Promise.all([probe(`${ctx.appUrl}/login`), probe(`${ctx.appUrl}/api/health`)]);
  return { site, api };
}

function crashDumps() {
  try {
    const dir = app.getPath("crashDumps");
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".dmp") ? [e.name] : []));
    return walk(dir).length;
  } catch {
    return 0;
  }
}

async function collect() {
  const u = ctx.updaterState();
  return {
    ...base(),
    os: { name: os.type(), release: os.release(), cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGB: Math.round(os.totalmem() / 1e9) },
    versions: { chrome: process.versions.chrome, node: process.versions.node },
    update: { status: u.status, version: u.version, error: u.error },
    performance: perfSample(),
    gpu: gpuStatus(),
    permissions: mediaAccess(),
    connection: await connectivity(),
    crashDumps: crashDumps(),
    log: log.tail(60),
  };
}

function asText(r) {
  const { log: tail, ...rest } = r;
  return `${JSON.stringify(rest, null, 2)}\n\n--- log ---\n${tail}`;
}

/** Diagnostics window. */
let diagWin = null;
function open(parent) {
  if (diagWin && !diagWin.isDestroyed()) return diagWin.focus();
  diagWin = new BrowserWindow({
    parent: parent ?? undefined,
    width: 720,
    height: 640,
    title: "Diagnóstico do JUMZI",
    autoHideMenuBar: true,
    backgroundColor: "#1c1c1e",
    webPreferences: { preload: path.join(__dirname, "..", "preload-diag.js"), contextIsolation: true, sandbox: true },
  });
  diagWin.on("closed", () => (diagWin = null));
  void diagWin.loadFile(path.join(__dirname, "..", "diagnostics.html"));
}

function setup({ appUrl, installType, updaterState }) {
  ctx = { appUrl, installType, updaterState };
  crashReporter.start({ uploadToServer: false, compress: true });

  ipcMain.handle("diag:collect", async () => collect());
  ipcMain.handle("diag:copy", async () => {
    clipboard.writeText(asText(await collect()));
    return true;
  });
  ipcMain.handle("diag:logs", () => shell.openPath(log.logDir()));
  ipcMain.handle("diag:send", async () => {
    const r = await collect();
    await report("manual", { ...perfSample(), gpu: r.gpu, details: asText(r).slice(0, 3900) });
    log.info("diag_sent");
    return true;
  });

  app.on("render-process-gone", (_e, _wc, d) => {
    log.error("renderer_gone", { reason: d.reason, exitCode: d.exitCode });
    if (d.reason !== "clean-exit") void report("crash", { reason: `renderer:${d.reason}`, ...perfSample() });
  });
  app.on("child-process-gone", (_e, d) => {
    log.error("child_gone", { type: d.type, reason: d.reason, exitCode: d.exitCode });
    if (d.reason !== "clean-exit" && d.reason !== "killed") void report(d.type === "GPU" ? "gpu" : "crash", { reason: `${d.type}:${d.reason}`, gpu: gpuStatus() });
  });
  process.on("uncaughtException", (e) => {
    log.error("main_exception", { message: String(e && e.message).slice(0, 300), stack: String(e && e.stack).slice(0, 1200) });
    void report("crash", { reason: `main:${String(e && e.message).slice(0, 150)}` });
  });

  setInterval(() => {
    const s = perfSample();
    log.info("perf", s);
    if (Date.now() - lastPerfReport > 60 * 60 * 1000) {
      lastPerfReport = Date.now();
      void report("perf", s);
    }
  }, 15 * 60 * 1000).unref?.();
}

/** A window stopped responding (long freeze). */
function watchWindow(win) {
  win.on("unresponsive", () => {
    log.warn("window_unresponsive");
    void report("unresponsive", perfSample());
  });
  win.on("responsive", () => log.info("window_responsive"));
}

module.exports = { setup, open, watchWindow, report, perfSample };
