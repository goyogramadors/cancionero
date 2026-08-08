@echo off
REM Crea (o rehace) el acceso directo "Cancionero" en el escritorio.
REM Util al clonar el repo en otro computador: doble clic y listo.
setlocal
set "RAIZ=%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$d=[Environment]::GetFolderPath('Desktop');" ^
  "$w=New-Object -ComObject WScript.Shell;" ^
  "$s=$w.CreateShortcut((Join-Path $d 'Cancionero.lnk'));" ^
  "$s.TargetPath='%~dp0motor.bat';" ^
  "$s.WorkingDirectory='%~dp0';" ^
  "$s.IconLocation=(Resolve-Path '%RAIZ%\app\pwa\cancionero.ico').Path + ',0';" ^
  "$s.Description='Cancionero: karaoke con afinacion, acordes y letras';" ^
  "$s.WindowStyle=1; $s.Save();" ^
  "Write-Host ('Listo: ' + (Join-Path $d 'Cancionero.lnk'))"
echo.
pause
