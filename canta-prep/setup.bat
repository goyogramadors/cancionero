@echo off
setlocal
cd /d "%~dp0"
echo == Canta prep: instalacion ==
where python >nul 2>nul || (
  echo ERROR: no se encontro python en el PATH.
  exit /b 1
)
if exist ".venv\Scripts\python.exe" (
  echo El entorno .venv ya existe, se reutiliza.
) else (
  echo Creando entorno virtual .venv...
  python -m venv .venv || goto :error
)
echo Instalando dependencias. La primera vez baja ~1.2 GB con torch CPU; paciencia...
".venv\Scripts\python" -m pip install --no-input --upgrade pip || goto :error
".venv\Scripts\python" -m pip install --no-input -r requirements.txt || goto :error
echo.
echo Listo. Prepara canciones con prep.bat
exit /b 0
:error
echo.
echo ERROR: fallo la instalacion. Revisa el mensaje de arriba.
exit /b 1
