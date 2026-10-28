# Morfi - vigilante. instalar.ps1 lo registra como tarea de Windows (SYSTEM) que corre cada 5 minutos:
# si Morfi no responde en /api/salud, lo vuelve a levantar con iniciar-morfi.bat (pm2 caído, proceso detenido
# o con error). La tarea de inicio solo corre al prender la PC: sin esto, si el servidor se caía en pleno día,
# quedaba apagado hasta que alguien reiniciara la PC.
# No hace nada mientras se está actualizando (la actualización detiene el servidor a propósito).
# Deja lo que hace en logs\vigilante.log.
param(
  [string]$Pm2,            # ruta a pm2.cmd (SYSTEM no tiene en el PATH lo instalado con npm -g)
  [int]$Puerto = 3000
)
$ErrorActionPreference = 'Continue'
$raiz = Split-Path (Split-Path $PSScriptRoot)
$log = Join-Path $raiz 'logs\vigilante.log'
function Anotar($t) {
  New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
  Add-Content $log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $t"
  # Se queda con las últimas 500 líneas: corre todo el día, todos los días
  $l = Get-Content $log; if ($l.Count -gt 500) { $l | Select-Object -Last 500 | Set-Content $log }
}
# Cualquier respuesta HTTP sirve (503 = falta la copia en la nube, pero Morfi anda)
function Responde {
  try { [void](Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 "http://127.0.0.1:$Puerto/api/salud"); $true }
  catch { [bool]$_.Exception.Response }
}
function Actualizando {
  if ((Get-ScheduledTask -TaskName 'Morfi - actualizar' -ErrorAction SilentlyContinue).State -eq 'Running') { return $true }
  [bool](Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'actualizar' })
}

if (Responde) { exit 0 }
# Una falla suelta (la PC recién prendida, un reinicio de pm2) no alcanza: se vuelve a probar antes de tocar nada
Start-Sleep -Seconds 30
if ((Responde) -or (Actualizando)) { exit 0 }

$pm2Home = [Environment]::GetEnvironmentVariable('PM2_HOME', 'Machine')
if ($pm2Home) { $env:PM2_HOME = $pm2Home }
Anotar 'Morfi no responde: lo levanto'
$bat = Join-Path $raiz 'iniciar-morfi.bat'
if ($Pm2) { & cmd.exe /c "`"$bat`" `"$Pm2`"" | Out-Null } else { & cmd.exe /c "`"$bat`"" | Out-Null }
$cmdPm2 = if ($Pm2) { $Pm2 } else { 'pm2' }
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 3
  if (Responde) { Anotar 'Morfi volvió a responder'; exit 0 }
  # El proceso existe pero quedó detenido o con error: "pm2 start" no lo reinicia, "restart" sí
  if ($i -eq 5) { & $cmdPm2 restart morfi 2>&1 | Out-Null }
}
Anotar "Sigue sin responder. Últimas líneas de logs\pm2-error.log:"
Get-Content (Join-Path $raiz 'logs\pm2-error.log') -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Anotar "  $_" }
exit 1
