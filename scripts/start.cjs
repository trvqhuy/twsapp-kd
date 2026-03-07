const { spawn } = require("child_process");
const path = require("path");

const electronPath = require("electron");
const appPath = process.cwd();

const args = [appPath, ...process.argv.slice(2)];

if (process.platform === "linux") {
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (!process.env.TMPDIR && runtimeDir) {
    process.env.TMPDIR = runtimeDir;
  }
  args.push("--disable-dev-shm-usage", "--no-sandbox", "--disable-setuid-sandbox");
}

const child = spawn(electronPath, args, {
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
