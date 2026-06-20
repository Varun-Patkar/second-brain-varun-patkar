<#
.SYNOPSIS
    Forwards local AI services (Whisper STT and/or LM Studio) through Microsoft
    dev tunnels and prints the public URLs to paste into the Second Brain settings.

.DESCRIPTION
    A one-and-done helper: it ensures you are logged in to dev tunnels, creates (or
    reuses) a persistent tunnel, adds anonymous-accessible port forwards for the
    selected service(s), hosts the tunnel in the background, and prints the
    resulting `https://<id>-<port>.devtunnels.ms` URLs. The tunnel stays live until
    you press 'q' (or Ctrl+C), which stops hosting and closes the forwards.

    By default only the STT/Whisper port is forwarded. Use -Service to forward LM
    Studio instead, or both.

    Prerequisites:
      - devtunnel CLI installed and on PATH (https://aka.ms/devtunnel).
      - The relevant local server(s) running: Whisper STT (default port 9000)
        and/or LM Studio's OpenAI-compatible server (default port 1234).

.PARAMETER Service
    Which local service(s) to expose: "stt" (default), "lmstudio", or "both".

.PARAMETER LmStudioPort
    Local port LM Studio's server listens on. Default 1234.

.PARAMETER SttPort
    Local port the Whisper STT server listens on. Default 9000.

.PARAMETER TunnelId
    A stable tunnel id to reuse across runs (so URLs stay the same). Default "second-brain".

.EXAMPLE
    ./scripts/tunnels.ps1
    Forwards only the STT/Whisper port (9000) and prints its public URL.

.EXAMPLE
    ./scripts/tunnels.ps1 -Service both
    Forwards both LM Studio (1234) and STT (9000).

.EXAMPLE
    ./scripts/tunnels.ps1 -Service lmstudio
    Forwards only LM Studio (1234).

.NOTES
    Anonymous access is enabled so the browser and worker can reach the endpoints
    without a tunnel token. The tunnel keeps running until you press 'q' to close it.
#>

[CmdletBinding()]
param(
    # Which local service(s) to expose. Default exposes only the STT/Whisper server.
    [ValidateSet("stt", "lmstudio", "both")]
    [string]$Service = "stt",
    [int]$LmStudioPort = 1234,
    [int]$SttPort = 9000,
    [string]$TunnelId = "second-brain"
)

$ErrorActionPreference = "Stop"

# Resolve which ports to forward from the chosen service.
switch ($Service) {
    "stt"      { $ports = @($SttPort) }
    "lmstudio" { $ports = @($LmStudioPort) }
    "both"     { $ports = @($LmStudioPort, $SttPort) }
}
Write-Host "Service: $Service  ->  port(s): $($ports -join ', ')" -ForegroundColor Cyan

# 1) Verify the CLI is available.
if (-not (Get-Command devtunnel -ErrorAction SilentlyContinue)) {
    Write-Error "devtunnel CLI not found on PATH. Install it from https://aka.ms/devtunnel and re-run."
    exit 1
}

# 2) Ensure we are logged in (no-op if a valid session already exists).
Write-Host "Checking dev tunnel login..." -ForegroundColor Cyan
try {
    devtunnel user show 2>$null | Out-Null
} catch {
    Write-Host "Not logged in — launching login (GitHub or Microsoft account)..." -ForegroundColor Yellow
    devtunnel user login
}

# 3) Create the tunnel if it does not already exist (reuse keeps URLs stable).
$existing = devtunnel show $TunnelId 2>$null
if ($LASTEXITCODE -ne 0 -or -not $existing) {
    Write-Host "Creating tunnel '$TunnelId'..." -ForegroundColor Cyan
    devtunnel create $TunnelId | Out-Null
} else {
    Write-Host "Reusing existing tunnel '$TunnelId'." -ForegroundColor Cyan
}

# 4) Register the selected port forwards (idempotent — ignore "already exists" errors).
foreach ($p in $ports) {
    Write-Host "Adding port $p (anonymous access)..." -ForegroundColor Cyan
    devtunnel port create $TunnelId -p $p --protocol https 2>$null | Out-Null
    devtunnel access create $TunnelId -p $p --anonymous 2>$null | Out-Null
}

# 5) Show the public URLs so they can be pasted once into the app settings.
Write-Host "`nPublic URLs (paste into Second Brain settings):" -ForegroundColor Green
devtunnel show $TunnelId

if ($Service -ne "stt") {
    Write-Host "`n  • LM Studio   -> the port-$LmStudioPort URL  (LM Studio Devtunnel URL field, append /v1)" -ForegroundColor Green
}
if ($Service -ne "lmstudio") {
    Write-Host "  • STT/Whisper -> the port-$SttPort URL    (Speech-to-text URL field)" -ForegroundColor Green
}

# 6) Host the tunnel in the background so this window can keep showing the URLs
#    and accept a quit key. Output is redirected to a temp log to keep the prompt
#    readable. Pressing 'q' (or Ctrl+C) stops hosting and closes the tunnel.
$log = Join-Path $env:TEMP "devtunnel-$TunnelId.log"
$host_proc = Start-Process -FilePath "devtunnel" -ArgumentList @("host", $TunnelId) `
    -NoNewWindow -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"

try {
    Write-Host "`nTunnel is live. Press 'q' to stop hosting and close the tunnel.`n" -ForegroundColor Cyan
    # Wait for the user to press 'q' (case-insensitive). Exit early if the host dies.
    while (-not $host_proc.HasExited) {
        if ([Console]::KeyAvailable) {
            $key = [Console]::ReadKey($true)
            if ($key.KeyChar -eq 'q' -or $key.KeyChar -eq 'Q') { break }
        }
        Start-Sleep -Milliseconds 150
    }
} finally {
    # Stop hosting (closes the public forwards) on quit or Ctrl+C.
    if ($host_proc -and -not $host_proc.HasExited) {
        Write-Host "`nClosing tunnel..." -ForegroundColor Yellow
        Stop-Process -Id $host_proc.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $log, "$log.err" -ErrorAction SilentlyContinue
    Write-Host "Tunnel closed." -ForegroundColor Green
}

