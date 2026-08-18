const { spawn } = require("child_process");
const { applyBlockedDomains } = require("./hosts");
const { DATA_DIR } = require("./paths");
const { log } = require("./log");

// Removes every trace of Guardrail from this machine. Triggered when the portal no
// longer recognises this device (the Controller deleted it), so the laptop cleans
// itself up instead of being left with stale blocks and no way to manage them.
//
// The final directory removal has to happen from a detached process: this one is
// running out of that same directory, so it can't delete itself. The spawned script
// waits for our PID to disappear first.
function selfUninstall() {
  log("Device was removed from the portal - uninstalling Guardrail from this machine.");

  // Release blocks in-process first so browsing is restored immediately, even if
  // anything below fails.
  try {
    applyBlockedDomains([]);
    log("Released all hosts-file blocks.");
  } catch (e) {
    log("Failed to release hosts-file blocks:", e.message);
  }

  const ps = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    // Wait for this agent process to exit before deleting its own directory.
    `$deadline = (Get-Date).AddSeconds(30)`,
    `while ((Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }`,
    "Stop-ScheduledTask -TaskName 'GuardrailAgent'",
    "Unregister-ScheduledTask -TaskName 'GuardrailAgent' -Confirm:$false",
    "Remove-NetFirewallRule -DisplayName 'Guardrail-Block-DoH'",
    "Get-ChildItem Cert:\\LocalMachine\\Root | Where-Object { $_.Subject -match 'Guardrail Local CA' } | Remove-Item -Force",
    // Belt and braces - the agent already cleared these, but if it died first this
    // guarantees the machine isn't left with redirects pointing at a dead port.
    `$hostsPath = "$env:SystemRoot\\System32\\drivers\\etc\\hosts"`,
    "if (Test-Path $hostsPath) {",
    "  $c = Get-Content $hostsPath -Raw",
    "  if ($c -match 'GUARDRAIL-START') {",
    '    $clean = [regex]::Replace($c, "(?s)\\r?\\n# GUARDRAIL-START.*?# GUARDRAIL-END\\r?\\n?", [System.Environment]::NewLine)',
    "    Set-Content -Path $hostsPath -Value $clean -NoNewline",
    "  }",
    "}",
    `Remove-Item -Recurse -Force '${DATA_DIR}'`,
  ].join("; ");

  try {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      // Must not inherit our cwd - that's inside the directory being deleted, and a
      // process holding it open would make the removal fail.
      cwd: process.env.SystemRoot || "C:\\Windows",
    });
    child.unref();
    log("Cleanup process started; Guardrail will be fully removed shortly.");
  } catch (e) {
    log("Could not start the cleanup process:", e.message);
  }
}

module.exports = { selfUninstall };
