@echo off
chcp 65001 >nul
title ReMusic dev
cd /d "%~dp0"
rem Starts infrastructure, then API (http://127.0.0.1:4000) and web app (http://localhost:3000).
rem Stop with Ctrl+C. Run setup.bat first on a new machine.
docker compose -f infrastructure/docker/compose.yaml --env-file .env up -d --quiet-pull --wait --wait-timeout 180
if errorlevel 1 (
  echo [ERROR] Infrastructure did not start. Is Docker Desktop running?
  pause
  exit /b 1
)
start "" /b cmd /c "timeout /t 12 /nobreak >nul && start http://localhost:3000"
set TURBO_TELEMETRY_DISABLED=1
call pnpm dev
