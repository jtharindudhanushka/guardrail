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
}

Write-Host "Guardrail: downloading agent..."
${fileDownloads}

Write-Host "Guardrail: installing dependencies..."
Push-Location $appDir
node -e "" 2>$null
& npm install --production --no-audit --no-fund
Pop-Location

Write-Host "Guardrail: generating local certificate authority..."
Push-Location $appDir
& node agent.js --generate-ca
Pop-Location

Write-Host "Guardrail: trusting local CA (needed to whitelist specific YouTube videos)..."
certutil -addstore -f "Root" "$dataDir\\ca-cert.pem" | Out-Null

$config = @{ portalUrl = "${origin}"; pairingCode = "${code}" } | ConvertTo-Json
Set-Content -Path "$dataDir\\config.json" -Value $config

Write-Host "Guardrail: registering startup task..."
$action = New-ScheduledTaskAction -Execute "node.exe" -Argument "agent.js" -WorkingDirectory $appDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
Register-ScheduledTask -TaskName "GuardrailAgent" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Start-ScheduledTask -TaskName "GuardrailAgent"

Write-Host ""
Write-Host "Guardrail installed and running. It will start automatically on every boot."
`;

  return new NextResponse(script, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
