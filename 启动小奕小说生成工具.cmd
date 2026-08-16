@echo off
setlocal EnableExtensions

cd /d "%~dp0"
set "APP_EXE="

for %%F in ("%CD%\release\win-unpacked\*.exe" "%CD%\.worktrees\windows-desktop-electron\release\win-unpacked\*.exe") do (
  if exist "%%~fF" if /I not "%%~nxF"=="elevate.exe" (
    set "APP_EXE=%%~fF"
    goto :launch_app
  )
)

set "SOURCE_DIR=%CD%"
if not exist "%SOURCE_DIR%\package.json" set "SOURCE_DIR="
if not defined SOURCE_DIR if exist "%CD%\.worktrees\windows-desktop-electron\package.json" set "SOURCE_DIR=%CD%\.worktrees\windows-desktop-electron"

if not defined SOURCE_DIR goto :not_found
if not exist "%SOURCE_DIR%\node_modules\concurrently\package.json" goto :dependencies_missing

pushd "%SOURCE_DIR%"
call npm run desktop:dev
set "EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %EXIT_CODE%

:launch_app
for %%D in ("%APP_EXE%") do set "APP_DIR=%%~dpD"
start "" /D "%APP_DIR%" "%APP_EXE%"
exit /b 0

:dependencies_missing
echo Dependencies are missing in "%SOURCE_DIR%".
echo Run "npm install" there, then start this script again.
pause
exit /b 1

:not_found
echo No packaged app or desktop development project was found.
pause
exit /b 1
