@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "DC=docker compose -f infrastructure/docker/compose.yaml --env-file .env"

if "%~1"=="" goto :help
if /i "%~1"=="up"    ( %DC% up -d --wait --wait-timeout 180 && %DC% --profile init run --rm s3-init & goto :eof )
if /i "%~1"=="down"  ( %DC% down & goto :eof )
if /i "%~1"=="ps"    ( %DC% ps & goto :eof )
if /i "%~1"=="logs"  ( %DC% logs -f --tail 200 %2 & goto :eof )
if /i "%~1"=="psql"  ( %DC% exec postgres psql -U mp -d mp & goto :eof )
if /i "%~1"=="reset" goto :reset
goto :help

:reset
echo This DELETES all local data: database, redis, s3 files.
set /p OK=Type YES to continue: 
if not "%OK%"=="YES" ( echo Cancelled. & goto :eof )
%DC% down -v
goto :eof

:help
echo Usage: infra.bat up ^| down ^| ps ^| logs [service] ^| psql ^| reset
echo   up     start postgres, redis, s3, mailpit and create buckets
echo   down   stop containers (data is kept)
echo   ps     container status
echo   logs   follow logs
echo   psql   open SQL console
echo   reset  stop and DELETE all local data
