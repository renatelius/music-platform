@echo off
setlocal
chcp 65001 >nul
title ReMusic catalog import
cd /d "%~dp0"
rem Test catalog: full-length FMA tracks under open licenses (tools/catalog-import, ADR-017).
rem   catalog.bat            - menu
rem   catalog.bat --dry-run  - any options of "pnpm catalog:import --help" are passed through
rem Safe to run next to dev.bat. Run setup.bat first on a new machine.

set "ARGS=%*"
if not "%ARGS%"=="" goto :run

echo.
echo   ReMusic - test catalog (300 FMA tracks, CC0 / CC BY / CC BY-SA only)
echo.
echo   1  Dry run: estimate the download, nothing is imported
echo   2  Import: download and process until 300 tracks are ready
echo   3  Verify: check the catalog already in the database and S3
echo   4  Exit
echo.
choice /c 1234 /n /m "Choose 1-4: "
if errorlevel 4 exit /b 0
if errorlevel 3 ( set "ARGS=--verify" & goto :run )
if errorlevel 2 ( set "ARGS=" & goto :run )
set "ARGS=--dry-run"

:run
docker compose -f infrastructure/docker/compose.yaml --env-file .env up -d --quiet-pull --wait --wait-timeout 180
if errorlevel 1 (
  echo [ERROR] Infrastructure did not start. Is Docker Desktop running?
  pause
  exit /b 1
)
set TURBO_TELEMETRY_DISABLED=1
call pnpm catalog:import %ARGS%
set "CODE=%errorlevel%"
echo.
if "%CODE%"=="0" ( echo [OK] Done. ) else ( echo [!] Finished with errors - see RESULT and the messages above. )
pause
exit /b %CODE%
