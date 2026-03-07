const fs = require("fs");
const path = require("path");

const version = process.argv[2];
if (!version) {
  throw new Error("Release version argument is required.");
}

const root = path.resolve(__dirname, "..");
const filePath = path.join(root, "release-version.txt");
fs.writeFileSync(filePath, `${version}\n`, "utf8");
