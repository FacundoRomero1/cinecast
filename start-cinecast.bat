@echo off
title CineCast TV
cd /d "%~dp0"
echo ========================================================
echo               INICIANDO CINECAST TV
echo ========================================================
echo.

REM 1. Verificar si el servidor local ya esta corriendo en el puerto 3000
netstat -ano | findstr ":3000" >nul
if %errorlevel% neq 0 (
    echo [*] Iniciando servidor local CineCast...
    start "" /min cmd /c "npm run dev"
    timeout /t 3 /nobreak >nul
) else (
    echo [*] Servidor local ya activo en el puerto 3000.
)

REM 2. Lanzar ejecutable nativo compilado con su Working Directory correcto
if exist "%~dp0release\win-unpacked\CineCast TV.exe" (
    echo [*] Abriendo CineCast TV nativo compilado...
    start "" /d "%~dp0release\win-unpacked" "CineCast TV.exe"
) else (
    echo [*] Abriendo pantalla CineCast TV en Electron...
    npm run desktop
)
