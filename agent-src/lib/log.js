const fs = require("fs");
const { LOG_PATH } = require("./paths");

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_PATH, line + "\n");
  } catch {
    // best-effort logging only
  }
}

module.exports = { log };
