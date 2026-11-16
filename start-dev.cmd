@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Visa Atlas (dev)

call :check_node
if errorlevel 1 goto :failed

if exist "node_modules\maplibre-gl\package.json" goto :deps_ok
echo Installing dependencies...
call npm.cmd ci
if errorlevel 1 goto :failed
:deps_ok

if exist "data\generated\dataset.json" goto :data_ok
echo Building dataset...
call npm.cmd run data:build
if errorlevel 1 goto :failed
:data_ok

if exist "public\geo\countries.geo.json" goto :geo_ok
echo Building globe geometry...
call npm.cmd run geo:build
if errorlevel 1 goto :failed
:geo_ok

if exist "data\visaatlas.sqlite" goto :db_ok
echo Creating SQLite database...
call npm.cmd run db:rebuild
if errorlevel 1 goto :failed
:db_ok

echo.
echo API: http://127.0.0.1:3001
echo Web: http://127.0.0.1:5173
echo Press Ctrl+C to stop.
echo.
call npm.cmd run dev
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
echo Startup failed. Check the messages above.
pause
exit /b 1
