const path = require("path");
const fs = require("fs");

const DATA_DIR = process.env.GUARDRAIL_DATA_DIR || path.join(process.env.ProgramData || "C:\\ProgramData", "Guardrail");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

module.exports = {
  DATA_DIR,
  CONFIG_PATH: path.join(DATA_DIR, "config.json"),
  STATE_PATH: path.join(DATA_DIR, "state.json"),
  CA_KEY_PATH: path.join(DATA_DIR, "ca-key.pem"),
  CA_CERT_PATH: path.join(DATA_DIR, "ca-cert.pem"),
  LOG_PATH: path.join(DATA_DIR, "agent.log"),
};
