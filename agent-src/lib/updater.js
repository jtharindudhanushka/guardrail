const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process");
const vm = require("vm");
const { URL } = require("url");
const { DATA_DIR } = require("./paths");
const { log } = require("./log");

let localVersion = "1.0.0";
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  localVersion = pkg.version || "1.0.0";
} catch {
  // fallback if package.json cannot be read
}

let lastFailedVersion = null;
let lastFailedTime = 0;
const FAILED_RETRY_COOLDOWN_MS = 15 * 60 * 1000; // 15 mins cooldown before retrying a failed version

function shouldUpdate(remoteVersion) {
  if (!remoteVersion || typeof remoteVersion !== "string") return false;
  if (remoteVersion === localVersion) return false;
  if (remoteVersion === lastFailedVersion && Date.now() - lastFailedTime < FAILED_RETRY_COOLDOWN_MS) {
    return false;
  }
  return true;
}

function downloadText(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.get(url, { rejectUnauthorized: false }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`Failed to download ${urlStr}: HTTP ${res.statusCode}`));
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
  });
}

async function checkAndApply(portalUrl, remoteVersion, onBeforeExit) {
  if (!shouldUpdate(remoteVersion)) return false;

  log(`Auto-update: new version detected (${localVersion} -> ${remoteVersion}). Starting staged download...`);
  const stagingDir = path.join(DATA_DIR, "staging");
  const appDir = path.join(DATA_DIR, "app");
  const backupDir = path.join(DATA_DIR, "app.prev");

  try {
    // 1. Fetch file manifest
    const manifestStr = await downloadText(`${portalUrl}/api/agent-files/manifest`);
    const manifest = JSON.parse(manifestStr);
    const files = manifest.files || [];

    if (!files.length || !files.includes("agent.js")) {
      throw new Error("Invalid manifest received from portal");
    }

    // 2. Prepare staging directory
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    fs.mkdirSync(stagingDir, { recursive: true });

    // 3. Download each file
    for (const relFile of files) {
      const targetPath = path.join(stagingDir, relFile);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const content = await downloadText(`${portalUrl}/api/agent-files/${relFile}`);
      fs.writeFileSync(targetPath, content, "utf8");

      // 4. Pre-verify syntax on JavaScript files
      if (relFile.endsWith(".js")) {
        try {
          new vm.Script(content, { filename: relFile });
        } catch (syntaxErr) {
          throw new Error(`Syntax verification failed for ${relFile}: ${syntaxErr.message}`);
        }
      }
    }

    log(`Auto-update: all ${files.length} files downloaded and syntax-verified.`);

    // 5. Build detached PowerShell handoff script
    const ps = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      `$appDir = '${appDir.replace(/'/g, "''")}'`,
      `$backupDir = '${backupDir.replace(/'/g, "''")}'`,
      `$stagingDir = '${stagingDir.replace(/'/g, "''")}'`,
      `$agentPid = ${process.pid}`,
      // Wait for the running agent to exit
      "$deadline = (Get-Date).AddSeconds(20)",
      "while ((Get-Process -Id $agentPid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }",
      "Stop-Process -Id $agentPid -Force -ErrorAction SilentlyContinue",
      "Start-Sleep -Seconds 1",
      // Backup current app
      "if (Test-Path $backupDir) { Remove-Item -Recurse -Force $backupDir -ErrorAction SilentlyContinue }",
      "if (Test-Path $appDir) { Copy-Item -Path $appDir -Destination $backupDir -Recurse -Force }",
      // Copy staging into app
      "Copy-Item -Path \"$stagingDir\\*\" -Destination $appDir -Recurse -Force",
      "Remove-Item -Recurse -Force $stagingDir -ErrorAction SilentlyContinue",
      // Resolve node path
      "$node = Get-Command node -ErrorAction SilentlyContinue",
      "$nodePath = if ($node) { $node.Source } else { \"$env:ProgramFiles\\nodejs\\node.exe\" }",
      // Start new agent
      "try { Start-ScheduledTask -TaskName 'GuardrailAgent' -ErrorAction Stop } catch { Start-Process -FilePath $nodePath -ArgumentList 'agent.js' -WorkingDirectory $appDir -WindowStyle Hidden }",
      // Healthcheck: check if process is running after 6 seconds
      "Start-Sleep -Seconds 6",
      "$proc = Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*agent.js*' }",
      "if (-not $proc) {",
      // Rollback!
      "  if (Test-Path $backupDir) { Copy-Item -Path \"$backupDir\\*\" -Destination $appDir -Recurse -Force }",
      "  try { Start-ScheduledTask -TaskName 'GuardrailAgent' -ErrorAction SilentlyContinue } catch { Start-Process -FilePath $nodePath -ArgumentList 'agent.js' -WorkingDirectory $appDir -WindowStyle Hidden }",
      "}",
    ].join("; ");

    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      cwd: process.env.SystemRoot || "C:\\Windows",
    });
    child.unref();

    log(`Auto-update: updater spawned. Transferring to version ${remoteVersion}...`);

    if (typeof onBeforeExit === "function") {
      onBeforeExit();
    }
    process.exit(0);
  } catch (err) {
    log(`Auto-update failed: ${err.message}. Aborting update.`);
    lastFailedVersion = remoteVersion;
    lastFailedTime = Date.now();
    try {
      if (fs.existsSync(stagingDir)) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }
    } catch {}
    return false;
  }
}

module.exports = { shouldUpdate, checkAndApply, getLocalVersion: () => localVersion };
