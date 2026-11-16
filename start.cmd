@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Visa Atlas

call :check_node
if errorlevel 1 goto :failed

if exist "node_modules\maplibre-gl\package.json" goto :deps_ok
echo [1/4] Installing dependencies (first run)...
call npm.cmd ci
if errorlevel 1 goto :failed
:deps_ok

if exist "data\generated\dataset.json" goto :data_ok
echo [2/4] Building dataset...
call npm.cmd run data:build
if errorlevel 1 goto :failed
:data_ok

if exist "data\visaatlas.sqlite" goto :db_ok
echo [3/4] Creating SQLite database...
call npm.cmd run db:rebuild
if errorlevel 1 goto :failed
:db_ok

if exist "dist\index.html" goto :build_ok
echo [4/4] Building production bundle...
set "TEMP=%CD%\.esbuild-tmp"
set "TMP=%TEMP%"
if not exist ".esbuild-tmp" mkdir ".esbuild-tmp"
call npm.cmd run build
if errorlevel 1 goto :failed
:build_ok

if "%PORT%"=="" set "PORT=3001"
echo.
echo Visa Atlas is starting on http://127.0.0.1:%PORT%
echo Press Ctrl+C to stop.
echo.
call npm.cmd start
if errorlevel 1 goto :failed
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
exit /b 0

:failed
echo.
echo Startup failed. Run setup.cmd for a full re-initialization.
pause
exit /b 1
