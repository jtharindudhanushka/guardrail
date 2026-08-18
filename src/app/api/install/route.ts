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

# Clear any stale redirects from a previous install. Without this, a hosts entry left
# behind by a dead agent keeps sites unreachable (ERR_CONNECTION_REFUSED) even now.
$hostsPath = "$env:SystemRoot\\System32\\drivers\\etc\\hosts"
if (Test-Path $hostsPath) {
  $hostsContent = Get-Content $hostsPath -Raw
  if ($hostsContent -match "GUARDRAIL-START") {
    Write-Host "Guardrail: clearing stale hosts entries from a previous install..."
    $cleanedHosts = [regex]::Replace($hostsContent, "(?s)\\r?\\n# GUARDRAIL-START.*?# GUARDRAIL-END\\r?\\n?", "\`r\`n")
    Set-Content -Path $hostsPath -Value $cleanedHosts -NoNewline
  }
}

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

Write-Host "Guardrail: stopping any previous agent..."
Stop-ScheduledTask -TaskName "GuardrailAgent" -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*Guardrail*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# A wrapper .cmd avoids Task Scheduler quoting problems with paths that contain
# spaces (e.g. C:\\Program Files\\nodejs) and captures stdout/stderr so a failed
# launch leaves evidence instead of silently doing nothing.
$runnerPath = "$appDir\\run-agent.cmd"
$runner = "@echo off\`r\`ncd /d ""%~dp0""\`r\`n""$nodePath"" agent.js >> ""$dataDir\\agent-stdout.log"" 2>&1\`r\`n"
Set-Content -Path $runnerPath -Value $runner -Encoding ASCII

Write-Host "Guardrail: registering startup task..."
$action = New-ScheduledTaskAction -Execute $runnerPath -WorkingDirectory $appDir
$triggerBoot = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
# AllowStartIfOnBatteries / DontStopIfGoingOnBatteries are essential on a laptop:
# by default Task Scheduler refuses to start a task on battery power and reports
# no error, which looks exactly like the task silently never running.
$settings = New-ScheduledTaskSettingsSet \`
  -AllowStartIfOnBatteries \`
  -DontStopIfGoingOnBatteries \`
  -StartWhenAvailable \`
  -ExecutionTimeLimit ([TimeSpan]::Zero) \`
  -MultipleInstances IgnoreNew \`
  -RestartCount 999 \`
  -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "GuardrailAgent" -Action $action -Trigger $triggerBoot -Principal $principal -Settings $settings -Force | Out-Null

Start-ScheduledTask -TaskName "GuardrailAgent"

Write-Host "Guardrail: verifying the agent started and paired..."
$paired = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 2
  $configNow = Get-Content "$dataDir\\config.json" -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
  if ($configNow.apiKey) { $paired = $true; break }
}

$info = Get-ScheduledTaskInfo -TaskName "GuardrailAgent"
$running = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*agent.js*" }

Write-Host ""
if ($paired -and $running) {
  Write-Host "Guardrail is installed, paired, and running."
  Write-Host "It starts automatically on every boot - no terminal needs to stay open."
} else {
  Write-Host "Guardrail installed, but the agent isn't fully up yet."
  Write-Host "  paired:            $paired"
  Write-Host "  agent running:     $([bool]$running)"
  Write-Host "  last task result:  $($info.LastTaskResult)"
  Write-Host ""
  Write-Host "Check the logs:"
  Write-Host "  Get-Content ""$dataDir\\agent.log"" -Tail 30"
  Write-Host "  Get-Content ""$dataDir\\agent-stdout.log"" -Tail 30"
}
`;

  return new NextResponse(script, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
