# restart-dev.ps1
# Cleans up a stale Shopify dev session (orphaned app server + dead cloudflared
# tunnel) and starts a fresh one. Run this instead of `npm run dev` whenever the
# embedded app shows a Cloudflare 530 / "refused to display in a frame" error.
#
# Usage:  npm run dev:fresh      (or)      powershell -ExecutionPolicy Bypass -File .\restart-dev.ps1
# Optional: pass a different port ->  .\restart-dev.ps1 -Port 3457

param(
  [int]$Port = 3457
)

Write-Host "Cleaning up stale dev processes..." -ForegroundColor Cyan

# 1. Kill any leftover Cloudflare tunnel processes (these back the trycloudflare URL).
$tunnels = Get-Process cloudflared -ErrorAction SilentlyContinue
if ($tunnels) {
  foreach ($t in $tunnels) {
    Write-Host "  Stopping cloudflared (PID $($t.Id))"
    try { Stop-Process -Id $t.Id -Force -ErrorAction Stop } catch {}
  }
} else {
  Write-Host "  No cloudflared tunnel running."
}

# 2. Kill whatever is still holding the app dev port (the orphaned app server).
$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($conns) {
  $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $pids) {
    $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
    Write-Host "  Stopping process on port $Port (PID $procId, $name)"
    try { Stop-Process -Id $procId -Force -ErrorAction Stop } catch {}
  }
} else {
  Write-Host "  Nothing listening on port $Port."
}

Write-Host ""
Write-Host "Starting a fresh `shopify app dev` session..." -ForegroundColor Green
Write-Host "When it prints a Preview URL, open THAT (or load the app from Shopify admin > Apps)." -ForegroundColor Yellow
Write-Host "Do not reuse an old trycloudflare.com URL." -ForegroundColor Yellow
Write-Host ""

npm run dev
