@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Visa Atlas Setup

call :check_node
if errorlevel 1 goto :failed

echo.
echo [1/5] Installing dependencies...
if exist "node_modules\maplibre-gl\package.json" (
  echo      Dependencies already installed.
) else (
  call npm.cmd ci
  if errorlevel 1 goto :failed
)

echo [2/5] Building dataset...
call npm.cmd run data:build
if errorlevel 1 goto :failed

echo [3/5] Checking data...
call npm.cmd run data:check
if errorlevel 1 goto :failed

echo [4/5] Building globe geometry and SQLite...
call npm.cmd run geo:build
if errorlevel 1 goto :failed
call npm.cmd run db:rebuild
if errorlevel 1 goto :failed

echo [5/5] Building production bundle...
set "TEMP=%CD%\.esbuild-tmp"
set "TMP=%TEMP%"
if not exist ".esbuild-tmp" mkdir ".esbuild-tmp"
call npm.cmd run build
if errorlevel 1 goto :failed

echo.
echo Setup complete.
echo Start production: start.cmd
echo Start development: start-dev.cmd
echo.
pause
exit /b 0

:check_node
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js 24 or newer is required.
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 (
  echo ERROR: Node.js 24 or newer is required. Current version:
  node -v
  exit /b 1
)
echo Node.js:
node -v
exit /b 0

:failed
echo.
echo Setup failed. Check the messages above.
pause
exit /b 1
