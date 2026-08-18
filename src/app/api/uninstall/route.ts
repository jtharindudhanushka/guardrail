import { NextResponse } from "next/server";

// No pairing code needed - uninstall only touches local machine state.
export async function GET() {
  const script = `#Requires -RunAsAdministrator
$ErrorActionPreference = "SilentlyContinue"

Write-Host "Guardrail: stopping and removing the startup task..."
Stop-ScheduledTask -TaskName "GuardrailAgent"
Unregister-ScheduledTask -TaskName "GuardrailAgent" -Confirm:$false

Write-Host "Guardrail: killing any running agent process..."
# node.exe lives in Program Files, so match on the command line (agent.js), not the
# executable path - matching the path finds nothing and leaves the agent running.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*agent.js*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

$dataDir = "$env:ProgramData\\Guardrail"
$hostsPath = "$env:SystemRoot\\System32\\drivers\\etc\\hosts"

Write-Host "Guardrail: removing hosts file entries..."
if (Test-Path $hostsPath) {
  $content = Get-Content $hostsPath -Raw
  $cleaned = $content -replace '(?s)\\r?\\n# GUARDRAIL-START.*?# GUARDRAIL-END\\r?\\n?', "\`n"
  Set-Content -Path $hostsPath -Value $cleaned -NoNewline
}

Write-Host "Guardrail: removing the trusted local certificate..."
Get-ChildItem Cert:\\LocalMachine\\Root | Where-Object { $_.Subject -match "Guardrail Local CA" } | Remove-Item -Force

Write-Host "Guardrail: removing DNS-over-HTTPS firewall block..."
Remove-NetFirewallRule -DisplayName "Guardrail-Block-DoH" -ErrorAction SilentlyContinue

Write-Host "Guardrail: removing installed files..."
Remove-Item -Recurse -Force $dataDir -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Guardrail has been fully removed from this machine."
`;

  return new NextResponse(script, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
