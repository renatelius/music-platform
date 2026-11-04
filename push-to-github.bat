@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Push to GitHub

rem ============================================================
rem  Push project to GitHub
rem  Usage:
rem    push-to-github.bat                 - auto commit message
rem    push-to-github.bat "my message"    - custom commit message
rem ============================================================

cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 goto :nogit

rem --- 1. Init repo if needed ---
if exist ".git" goto :identity
echo [*] Initializing git repository...
git init
git branch -M main

:identity
rem --- 2. Check git identity ---
git config user.name >nul 2>&1
if not errorlevel 1 goto :remote
echo [!] Git user.name is not set.
set /p GIT_NAME=Enter your name for commits: 
set /p GIT_EMAIL=Enter your GitHub email: 
git config --global user.name "!GIT_NAME!"
git config --global user.email "!GIT_EMAIL!"

:remote
rem --- 3. Configure remote on first run ---
git remote get-url origin >nul 2>&1
if not errorlevel 1 goto :commit
echo.
echo [!] GitHub remote is not configured.
echo     Create an EMPTY repository on https://github.com/new
echo     Example URL: https://github.com/USERNAME/music-platform.git
echo.
echo     Paste with right-click or Ctrl+V, then press Enter. Empty input = cancel.
echo.
:askurl
set "REPO_URL="
set /p REPO_URL=Paste repository URL: 
if "!REPO_URL!"=="" goto :nourl
echo !REPO_URL! | findstr /r /i "^https://github\.com/.*/.* ^git@github\.com:.*/.*" >nul
if errorlevel 1 (
    echo [!] This does not look like a GitHub repository URL. Try again.
    goto :askurl
)
git remote add origin "!REPO_URL!"

:commit
rem --- 4. Stage and commit ---
set "MSG=%~1"
if "!MSG!"=="" set "MSG=Update %date% %time:~0,8%"

git add -A
git diff --cached --quiet
if not errorlevel 1 (
    echo [=] No new changes to commit.
    goto :push
)
git commit -m "!MSG!"
if errorlevel 1 goto :fail

:push
rem --- 5. Push ---
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
echo [*] Pushing branch !BRANCH! to origin...
git push -u origin "!BRANCH!"
if errorlevel 1 goto :fail

echo.
echo [OK] Done. Project is on GitHub.
pause
exit /b 0

:nogit
echo [ERROR] Git not found. Install from https://git-scm.com/download/win
pause
exit /b 1

:nourl
echo [ERROR] Repository URL is empty - nothing was sent.
echo         Run push-to-github.bat again when the GitHub repository is created.
pause
exit /b 1

:fail
echo.
echo [ERROR] Something went wrong. See messages above.
echo   - Authorization: a browser window should open via Git Credential Manager.
echo   - If push is rejected, the GitHub repo may not be empty.
pause
exit /b 1
