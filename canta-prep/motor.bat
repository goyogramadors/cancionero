@echo off
setlocal
if exist "%~dp0.venv\Scripts\python.exe" (
  "%~dp0.venv\Scripts\python.exe" "%~dp0motor.py" %*
) else (
  echo AVISO: no existe el entorno .venv de canta-prep.
  echo        Se usara el python del sistema; para preparar canciones tienes
  echo        que correr setup.bat primero.
  echo.
  where python >nul 2>nul || (
    echo ERROR: tampoco se encontro python en el PATH. Instala Python 3.10 o mas.
    pause
    exit /b 1
  )
  python "%~dp0motor.py" %*
)
