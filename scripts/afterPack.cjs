const fs = require("fs");
const path = require("path");

module.exports = async (context) => {
  if (context.electronPlatformName !== "linux") {
    return;
  }

  const appOutDir = context.appOutDir;
  const executableName = context.packager.executableName;
  const binaryPath = path.join(appOutDir, executableName);
  const wrappedBinaryPath = path.join(appOutDir, `${executableName}-bin`);

  if (!fs.existsSync(binaryPath)) {
    return;
  }

  if (!fs.existsSync(wrappedBinaryPath)) {
    fs.renameSync(binaryPath, wrappedBinaryPath);
  }

  const wrapper = `#!/bin/sh
DIR="$(dirname "$0")"
exec "$DIR/${executableName}-bin" --no-sandbox --disable-setuid-sandbox "$@"
`;
  fs.writeFileSync(binaryPath, wrapper, "utf8");
  fs.chmodSync(binaryPath, 0o755);
};
