import { NextRequest, NextResponse } from "next/server";

const AGENT_FILES = [
  "agent.js",
  "package.json",
  "lib/paths.js",
  "lib/log.js",
  "lib/config.js",
  "lib/portalClient.js",
  "lib/hosts.js",
  "lib/state.js",
  "lib/certs.js",
  "lib/resolve.js",
  "lib/youtubeRules.js",
  "lib/blockPage.js",
  "lib/interceptServer.js",
];

export async function GET(req: NextRequest) {
  const rawCode = req.nextUrl.searchParams.get("code") || "";
  const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  const origin = `${req.headers.get("x-forwarded-proto") ?? "http"}://${req.headers.get("host")}`;

  const fileDownloads = AGENT_FILES.map(
    (f) =>
      `New-Item -ItemType Directory -Force -Path (Split-Path "$appDir\\${f}") | Out-Null\nInvoke-WebRequest -Uri "${origin}/api/agent-files/${f}" -OutFile "$appDir\\${f}"`
  ).join("\n");

  const script = `#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

$dataDir = "$env:ProgramData\\Guardrail"
$appDir = "$dataDir\\app"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
New-Item -ItemType Directory -Force -Path $appDir | Out-Null

Write-Host "Guardrail: checking for Node.js..."
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js not found - installing via winget..."
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  $node = Get-Command node -ErrorAction SilentlyContinue
}
if (-not $node) {
  $fallback = "$env:ProgramFiles\\nodejs\\node.exe"
  if (Test-Path $fallback) { $nodePath = $fallback } else { throw "Node.js install did not complete - re-run this installer after installing Node.js manually from nodejs.org." }
} else {
  $nodePath = $node.Source
}
Write-Host "Guardrail: using node at $nodePath"

Write-Host "Guardrail: downloading agent..."
${fileDownloads}

Write-Host "Guardrail: installing dependencies..."
Push-Location $appDir
& npm install --production --no-audit --no-fund
Pop-Location

Write-Host "Guardrail: generating local certificate authority..."
Push-Location $appDir
& $nodePath agent.js --generate-ca
Pop-Location

Write-Host "Guardrail: trusting local CA (needed to whitelist specific YouTube videos)..."
certutil -addstore -f "Root" "$dataDir\\ca-cert.pem" | Out-Null

Write-Host "Guardrail: blocking known DNS-over-HTTPS resolvers (so browser 'Secure DNS' can't bypass the hosts file)..."
$dohIPs = @(
  "1.1.1.1", "1.0.0.1",
  "8.8.8.8", "8.8.4.4",
  "9.9.9.9", "149.112.112.112",
  "208.67.222.222", "208.67.220.220",
  "185.228.168.9", "185.228.169.9",
  "94.140.14.14", "94.140.15.15"
)
Remove-NetFirewallRule -DisplayName "Guardrail-Block-DoH" -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName "Guardrail-Block-DoH" -Direction Outbound -Action Block -Protocol TCP -RemotePort 443,853 -RemoteAddress $dohIPs | Out-Null
New-NetFirewallRule -DisplayName "Guardrail-Block-DoH" -Direction Outbound -Action Block -Protocol UDP -RemotePort 443,853 -RemoteAddress $dohIPs | Out-Null

$config = @{ portalUrl = "${origin}"; pairingCode = "${code}" } | ConvertTo-Json
Set-Content -Path "$dataDir\\config.json" -Value $config

Write-Host "Guardrail: registering startup task..."
$action = New-ScheduledTaskAction -Execute $nodePath -Argument "agent.js" -WorkingDirectory $appDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
Register-ScheduledTask -TaskName "GuardrailAgent" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Start-ScheduledTask -TaskName "GuardrailAgent"

Write-Host "Guardrail: verifying the agent started and paired..."
Start-Sleep -Seconds 5
$info = Get-ScheduledTaskInfo -TaskName "GuardrailAgent"
$configNow = Get-Content "$dataDir\\config.json" -Raw | ConvertFrom-Json

Write-Host ""
if ($configNow.apiKey) {
  Write-Host "Guardrail installed and paired. It will start automatically on every boot."
} else {
  Write-Host "Guardrail installed, but pairing hasn't completed yet (last task result: $($info.LastTaskResult))."
  Write-Host "Check the log for details:"
  Write-Host "  Get-Content ""$dataDir\\agent.log"" -Tail 30"
}
`;

  return new NextResponse(script, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
