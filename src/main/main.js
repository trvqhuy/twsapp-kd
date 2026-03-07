import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.commandLine.appendSwitch("disable-gpu-vsync");
if (process.platform === "linux" && app.isPackaged) {
  app.commandLine.appendSwitch("no-sandbox");
}

const parseArgs = () => {
  const args = process.argv.slice(2);
  const config = {
    mode: "mock",
    requestedMode: null,
    configPath: null,
    backendHost: "127.0.0.1",
    backendPort: 8765
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--mode=")) {
      config.requestedMode = arg.split("=")[1];
      continue;
    }
    if (arg.startsWith("--config=")) {
      config.configPath = arg.split("=")[1];
      continue;
    }
    if (arg.startsWith("--backend-host=")) {
      config.backendHost = arg.split("=")[1];
      continue;
    }
    if (arg.startsWith("--backend-port=")) {
      config.backendPort = Number(arg.split("=")[1]);
      continue;
    }
    if (arg === "--mode" && args[i + 1]) {
      config.requestedMode = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--config" && args[i + 1]) {
      config.configPath = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--backend-host" && args[i + 1]) {
      config.backendHost = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--backend-port" && args[i + 1]) {
      config.backendPort = Number(args[i + 1]);
      i += 1;
    }
  }

  return config;
};

const resolveRuntimeConfig = async () => {
  const parsed = parseArgs();
  const requested = parsed.requestedMode || "live";
  const fallbackConfigPath = path.join(app.getPath("userData"), "ibkr-config.json");
  const configPath = parsed.configPath || fallbackConfigPath;
  const runtime = {
    mode: "live",
    requestedMode: requested,
    configPath,
    banner: null,
    appVersion: app.getVersion(),
    userDataPath: app.getPath("userData"),
    backendUrl: `ws://${parsed.backendHost}:${parsed.backendPort}`,
    backendHost: parsed.backendHost,
    backendPort: parsed.backendPort,
    backendAutoLaunch: true
  };

  if (requested !== "live") {
    runtime.banner = "Mock mode is disabled. Running in live mode.";
  }

  try {
    await fs.access(configPath);
  } catch {
    runtime.banner = "Config not found. A default config will be created.";
  }

  return runtime;
};

let backendProcess = null;
let backendRestartTimer = null;
let activeWindow = null;
let runtimeCache = null;


const resolvePythonBin = () => {
  if (process.env.PYTHON_BIN) {
    return process.env.PYTHON_BIN;
  }
  const appPath = app.getAppPath();
  const resourcesPath = process.resourcesPath || appPath;
  const candidates = [
    path.join(resourcesPath, "python", "python.exe"),
    path.join(resourcesPath, "python", "bin", "python3"),
    path.join(resourcesPath, "python", "bin", "python"),
    path.join(resourcesPath, "python", "Scripts", "python.exe"),
    path.join(appPath, "..", ".venv", "bin", "python"),
    path.join(appPath, "..", ".venv", "bin", "python3"),
    path.join(appPath, "..", ".venv", "Scripts", "python.exe"),
    path.join(appPath, ".venv", "bin", "python"),
    path.join(appPath, ".venv", "bin", "python3"),
    path.join(appPath, ".venv", "Scripts", "python.exe")
  ];
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  return process.platform === "win32" ? "python" : "python3";
};

const resolveBackendRoot = () => path.join(app.getAppPath(), "backend");

const resolveBackendBinary = () => {
  const resourcesPath = process.resourcesPath || app.getAppPath();
  const binaryName = process.platform === "win32" ? "ib_backend.exe" : "ib_backend";
  const candidate = path.join(resourcesPath, "backend", "bin", binaryName);
  if (fsSync.existsSync(candidate)) {
    return candidate;
  }
  return null;
};

const resolveBackendLauncher = () => {
  if (app.isPackaged) {
    const binaryPath = resolveBackendBinary();
    if (!binaryPath) {
      return null;
    }
    return {
      type: "binary",
      command: binaryPath,
      args: [],
      cwd: path.dirname(binaryPath)
    };
  }
  return {
    type: "python",
    command: resolvePythonBin(),
    args: ["-m", "ib_backend.server"],
    cwd: resolveBackendRoot()
  };
};

const startBackend = (runtimeConfig, win) => {
  if (runtimeConfig.mode !== "live" || backendProcess) {
    return null;
  }
  const sendLog = (payload) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send("backend-log", payload);
    }
  };
  const backendLaunch = resolveBackendLauncher();
  if (!backendLaunch) {
    const errorMessage = "Backend executable missing. Reinstall or contact support.";
    console.error(`[backend] ${errorMessage}`);
    sendLog({ level: "error", message: errorMessage });
    return null;
  }
  const args = [
    ...backendLaunch.args,
    "--config",
    runtimeConfig.configPath,
    "--host",
    runtimeConfig.backendHost,
    "--port",
    String(runtimeConfig.backendPort)
  ];

  backendProcess = spawn(backendLaunch.command, args, {
    cwd: backendLaunch.cwd,
    stdio: "pipe",
    env: { ...process.env }
  });

  backendProcess.stdout.on("data", (data) => {
    const message = data.toString().trim();
    if (message) {
      console.log(`[backend] ${message}`);
      sendLog({ level: "info", message });
    }
  });
  backendProcess.stderr.on("data", (data) => {
    const message = data.toString().trim();
    if (message) {
      console.error(`[backend] ${message}`);
      sendLog({ level: "error", message });
    }
  });
  backendProcess.on("exit", (code) => {
    console.warn(`[backend] exited with code ${code}`);
    sendLog({ level: "warn", message: `Backend exited (code ${code}). Restarting...` });
    backendProcess = null;
    if (!backendRestartTimer) {
      backendRestartTimer = setTimeout(() => {
        backendRestartTimer = null;
        startBackend(runtimeConfig, win);
      }, 1500);
    }
  });
  backendProcess.on("error", (error) => {
    console.error(`[backend] failed to start: ${error.message}`);
    sendLog({ level: "error", message: `Backend failed to start: ${error.message}` });
  });

  return backendProcess;
};

let updaterInitialized = false;

const sendUpdateEvent = (payload) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send("update-event", payload);
    }
  });
};

const initAutoUpdater = () => {
  if (updaterInitialized) {
    return;
  }
  updaterInitialized = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("checking-for-update", () => {
    sendUpdateEvent({ type: "checking-for-update" });
  });
  autoUpdater.on("update-available", (info) => {
    sendUpdateEvent({ type: "update-available", info });
  });
  autoUpdater.on("update-not-available", (info) => {
    sendUpdateEvent({ type: "update-not-available", info });
  });
  autoUpdater.on("error", (error) => {
    sendUpdateEvent({ type: "error", message: error?.message || "Update error" });
  });
  autoUpdater.on("download-progress", (progress) => {
    sendUpdateEvent({ type: "download-progress", progress });
  });
  autoUpdater.on("update-downloaded", (info) => {
    sendUpdateEvent({ type: "update-downloaded", info });
  });
};


const createWindow = async () => {
  const runtimeConfig = await resolveRuntimeConfig();
  runtimeCache = runtimeConfig;

  const win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1200,
    minHeight: 720,
    backgroundColor: "#0f1412",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "../preload/preload.cjs")
    }
  });

  ipcMain.handle("runtime-config", () => runtimeConfig);
  ipcMain.handle("export-logs", async (event, payload) => {
    const { content, suggestedName } = payload || {};
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Export Logs",
      defaultPath: suggestedName || "hybrid-bot-logs.txt",
      filters: [
        { name: "Text Files", extensions: ["txt", "log"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });

    if (canceled || !filePath) {
      return { canceled: true };
    }

    await fs.writeFile(filePath, content || "", "utf8");
    return { canceled: false, filePath };
  });

  ipcMain.handle("export-strategies", async (event, payload) => {
    const { strategies, suggestedName } = payload || {};
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Export Strategies",
      defaultPath: suggestedName || "hybrid-bot-strategies.json",
      filters: [
        { name: "JSON Files", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });

    if (canceled || !filePath) {
      return { canceled: true };
    }

    const content = JSON.stringify(strategies || [], null, 2);
    await fs.writeFile(filePath, content, "utf8");
    return { canceled: false, filePath };
  });

  ipcMain.handle("import-strategies", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Import Strategies",
      properties: ["openFile"],
      filters: [
        { name: "JSON Files", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });

    if (canceled || !filePaths || !filePaths.length) {
      return { canceled: true };
    }

    const content = await fs.readFile(filePaths[0], "utf8");
    return { canceled: false, content };
  });

  activeWindow = win;
  startBackend(runtimeConfig, win);

  ipcMain.handle("update-check", async () => {
    if (!app.isPackaged) {
      return { ok: false, error: "Updates are only available in packaged builds." };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      return { ok: true, info: result?.updateInfo || null };
    } catch (error) {
      const message = error?.message || "Update check failed";
      sendUpdateEvent({ type: "error", message });
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("update-download", async () => {
    if (!app.isPackaged) {
      return { ok: false, error: "Updates are only available in packaged builds." };
    }
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (error) {
      const message = error?.message || "Update download failed";
      sendUpdateEvent({ type: "error", message });
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("update-install", async () => {
    if (!app.isPackaged) {
      return { ok: false, error: "Updates are only available in packaged builds." };
    }
    autoUpdater.quitAndInstall();
    return { ok: true };
  });

  await win.loadFile(path.join(__dirname, "../renderer/index.html"), {
    query: {
      mode: runtimeConfig.mode,
      backendUrl: runtimeConfig.backendUrl || "",
      configPath: runtimeConfig.configPath || "",
      appVersion: runtimeConfig.appVersion || "",
      banner: runtimeConfig.banner || ""
    }
  });
};

app.whenReady().then(() => {
  initAutoUpdater();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
