# Fadido - vigilante. instalar.ps1 lo registra como tarea de Windows (SYSTEM) que corre cada 5 minutos:
# si Fadido no responde en /api/salud, lo vuelve a levantar con iniciar-fadido.bat (pm2 caído, proceso detenido
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
# Cualquier respuesta HTTP sirve (503 = falta la copia en la nube, pero Fadido anda)
function Responde {
  try { [void](Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 "http://127.0.0.1:$Puerto/api/salud"); $true }
  catch { [bool]$_.Exception.Response }
}
function Actualizando {
  foreach ($t in 'Fadido - actualizar', 'Morfi - actualizar') { if ((Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue).State -eq 'Running') { return $true } }
  [bool](Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'actualizar' })
}


# ----- Actualizaciones sin tocar la PC (src/servicios/actualizaciones.js) -----
# Corre como SYSTEM: arranca la tarea "Fadido - actualizar" (scripts/actualizar.js: copia, actualiza y si algo
# falla vuelve a la versión anterior). Si la instalación no la tenía (sin -ActualizacionAutomatica), la crea sin
# horario: solo corre cuando se la pide.
function Lanzar-Actualizacion($motivo) {
  if (Actualizando) { return }
  $nombre = @('Fadido - actualizar', 'Morfi - actualizar') | Where-Object { Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue } | Select-Object -First 1
  if (-not $nombre) {
    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    if (-not $npm) { Anotar 'No encuentro npm: no se puede actualizar'; return }
    $pm2Dir = if ($Pm2) { Split-Path $Pm2 } else { '' }
    $accion = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c cd /d `"$raiz`" && set `"PATH=$pm2Dir;%PATH%`" && `"$npm`" run actualizar" -WorkingDirectory $raiz
    $ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
    $sistema = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $nombre = 'Fadido - actualizar'
    Register-ScheduledTask -TaskName $nombre -Action $accion -Principal $sistema -Settings $ajustes -Force | Out-Null
  }
  Start-ScheduledTask -TaskName $nombre
  Anotar "Actualización iniciada ($motivo)"
}

function Revisar-Actualizacion {
  # 1) El administrador tocó "Actualizar ahora" en Fadido
  $pedido = Join-Path $raiz 'data\actualizar-ahora.json'
  if (Test-Path $pedido) { Remove-Item $pedido -Force; Lanzar-Actualizacion 'pedida desde Fadido'; return }
  # 2) Automática: cada 30 minutos se mira si hay versión nueva; se instala solo con el local tranquilo
  #    (Fadido lo dice: sin pedidos abiertos, caja cerrada y 30 minutos sin movimiento; apagable en Configuración)
  $marca = Join-Path $raiz 'logs\revision-version.txt'
  if ((Test-Path $marca) -and ((Get-Date) - (Get-Item $marca).LastWriteTime).TotalMinutes -lt 30) { return }
  $intentada = if (Test-Path $marca) { (Get-Content $marca -ErrorAction SilentlyContinue | Select-Object -First 1) } else { '' }
  New-Item -ItemType Directory -Force (Split-Path $marca) | Out-Null
  Set-Content $marca $intentada
  try { $t = Invoke-RestMethod -TimeoutSec 10 "http://127.0.0.1:$Puerto/api/sistema/tranquilo" } catch { return }
  if (-not $t.tranquilo) { return }
  git -C $raiz fetch -q origin main 2>&1 | Out-Null
  $local = (git -C $raiz rev-parse HEAD 2>$null); $nueva = (git -C $raiz rev-parse origin/main 2>$null)
  if (-not $local -or -not $nueva -or $local -eq $nueva) { return }
  # Si esa misma versión ya se intentó y volvió atrás, no se reintenta sola (queda "Actualizar ahora")
  if ($intentada -eq $nueva) { return }
  Set-Content $marca $nueva
  Lanzar-Actualizacion "versión nueva $($nueva.Substring(0, 7)) con el local tranquilo"
}

if (Responde) { Revisar-Actualizacion; exit 0 }
# Una falla suelta (la PC recién prendida, un reinicio de pm2) no alcanza: se vuelve a probar antes de tocar nada
Start-Sleep -Seconds 30
if ((Responde) -or (Actualizando)) { exit 0 }

$pm2Home = [Environment]::GetEnvironmentVariable('PM2_HOME', 'Machine')
if ($pm2Home) { $env:PM2_HOME = $pm2Home }
Anotar 'Fadido no responde: lo levanto'
$bat = Join-Path $raiz 'iniciar-fadido.bat'
if (-not (Test-Path $bat)) { $bat = Join-Path $raiz 'iniciar-morfi.bat' }
if ($Pm2) { & cmd.exe /c "`"$bat`" `"$Pm2`"" | Out-Null } else { & cmd.exe /c "`"$bat`"" | Out-Null }
$cmdPm2 = if ($Pm2) { $Pm2 } else { 'pm2' }
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 3
  if (Responde) { Anotar 'Fadido volvió a responder'; exit 0 }
  # El proceso existe pero quedó detenido o con error: "pm2 start" no lo reinicia, "restart" sí
  if ($i -eq 5) { & $cmdPm2 restart fadido 2>&1 | Out-Null; & $cmdPm2 restart morfi 2>&1 | Out-Null }
}
Anotar "Sigue sin responder. Últimas líneas de logs\pm2-error.log:"
Get-Content (Join-Path $raiz 'logs\pm2-error.log') -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Anotar "  $_" }
exit 1
