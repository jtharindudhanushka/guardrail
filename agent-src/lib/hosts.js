const fs = require("fs");
const path = require("path");

const HOSTS_PATH = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts");
const START_MARK = "# GUARDRAIL-START";
const END_MARK = "# GUARDRAIL-END";

function readHosts() {
  try {
    return fs.readFileSync(HOSTS_PATH, "utf8");
  } catch {
    return "";
  }
}

// Redirects `domains` (and their www. variant) to 127.0.0.1 by rewriting a marked block
// in the hosts file. Everything outside the marked block is left untouched.
function applyBlockedDomains(domains) {
  const current = readHosts();
  const startIdx = current.indexOf(START_MARK);
  const endIdx = current.indexOf(END_MARK);

  let base = current;
  if (startIdx !== -1 && endIdx !== -1) {
    base = current.slice(0, startIdx) + current.slice(endIdx + END_MARK.length);
  }
  base = base.replace(/\n{3,}/g, "\n\n").trimEnd();

  const lines = [];
  for (const domain of domains) {
    lines.push(`127.0.0.1 ${domain}`);
    if (!domain.startsWith("www.")) lines.push(`127.0.0.1 www.${domain}`);
  }

  const block = domains.length
    ? `\n${START_MARK}\n${lines.join("\n")}\n${END_MARK}\n`
    : `\n${START_MARK}\n${END_MARK}\n`;

  fs.writeFileSync(HOSTS_PATH, base + block, "utf8");
}

module.exports = { applyBlockedDomains };
