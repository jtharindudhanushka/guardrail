const fs = require("fs");
const { STATE_PATH } = require("./paths");

function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    if (raw.dateKey === localDateKey()) return raw;
  } catch {
    // fall through to a fresh state
  }
  return { dateKey: localDateKey(), usage: {} };
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

module.exports = { localDateKey, loadState, saveState };
