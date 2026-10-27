@echo off
rem Arranca el panel de marges y lo abre en el navegador.
rem Credenciales: las del matcher de Hortitec (no se copian). Para independizarlo, crea un .env aqui.
cd /d "%~dp0"
if not exist ".env" set FACTUSOL_ENV_FILE=C:\Users\andan\source\Factu-Hortitec-Matcher\.env
start "" "http://127.0.0.1:4100/"
node src/server.js
pause
