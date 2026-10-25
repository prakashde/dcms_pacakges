@echo off
setlocal EnableExtensions
title DCMS Form Packages - One-Click Build and Install

rem ============================================================
rem  INSTALL_ALL.bat - runs every step of DCMS_INSTALL_GUIDE.html
rem  in one double-click:
rem
rem    STEP 1  npm ci + npm run build + npm run pack   [packages repo]
rem    STEP 2  copy fresh tarballs into the app vendor folder
rem            [+ binary check against the artifacts]
rem    STEP 3  read the file:vendor specs from the app package.json
rem    STEP 4  delete stale node_modules\@dcms and node_modules\.cache
rem    STEP 5  npm install --save-exact from the vendor tarballs
rem            (auto-runs scripts\refresh-dcms-lock.js fallback)
rem    STEP 6  verify lockfile fingerprints match the tarballs
rem            optional marker search if you pass a string
rem    then    choose: production build / dev server / finish
rem
rem  Usage:
rem    double-click, or:  INSTALL_ALL.bat
rem    INSTALL_ALL.bat "your marker string"   also greps for the marker
rem    INSTALL_ALL.bat /q                     no menu, no pause
rem ============================================================

rem ====================================================================
rem  CONFIG - the ONLY two variables to edit when folder names,
rem  directory names or paths change. Nothing else in this file
rem  hardcodes a path.
rem ====================================================================

rem  PACKAGES_DIR = the packages repo (github: prakashde/dcms_pacakges).
rem    Default below = the folder THIS .bat sits in, so it is always
rem    correct as long as the .bat stays inside the packages repo - the
rem    repo folder can have ANY name. If you move the .bat OUTSIDE the
rem    repo, replace the line with an absolute path, e.g.:
rem      set "PACKAGES_DIR=D:\ALL PROJECTS\dcms_pacakges"
set "PACKAGES_DIR=%~dp0"

rem  APP_DIR = the DCMS app repo (github: suyogb-DE/RI_DOCMANAGER_UI).
rem    Default below auto-detects the app folder sitting NEXT to this
rem    repo, trying the two known names. If your app folder has a
rem    different name, or lives somewhere else, replace the line with
rem    an absolute path, e.g.:
rem      set "APP_DIR=D:\ALL PROJECTS\RI_DOCMANAGER_UI"
set "APP_DIR="
for %%D in ("%~dp0..\DCMS" "%~dp0..\RI_DOCMANAGER_UI") do (
  if not defined APP_DIR if exist "%%~fD\package.json" set "APP_DIR=%%~fD"
)
rem set "APP_DIR=D:\ALL PROJECTS\DCMS"

rem  Normalize both - safe even when a directory was not found:
rem  PACKAGES_DIR keeps a trailing backslash, APP_DIR must not have one,
rem  so both can be written by hand either way (with or without it).
if defined PACKAGES_DIR for %%A in ("%PACKAGES_DIR%\") do set "PACKAGES_DIR=%%~fA"
if defined APP_DIR for %%A in ("%APP_DIR%\.") do set "APP_DIR=%%~fA"
rem ====================================================================

set "MARKER="
set "QUIET="

:parseArgs
if "%~1"=="" goto :argsDone
if /i "%~1"=="/q"     (set "QUIET=1" & shift & goto :parseArgs)
if /i "%~1"=="/quiet" (set "QUIET=1" & shift & goto :parseArgs)
set "MARKER=%~1"
shift
goto :parseArgs
:argsDone

echo.
echo ============================================================
echo  DCMS form packages - one-click build and install
echo ============================================================
echo  Packages : %PACKAGES_DIR%
echo  App      : %APP_DIR%
echo.

rem ---- environment checks ----
where node >nul 2>nul
if errorlevel 1 (set "FAILMSG=node is not on PATH - install Node.js 22.14.0 or newer" & goto :fail)
where npm >nul 2>nul
if errorlevel 1 (set "FAILMSG=npm is not on PATH - reinstall Node.js" & goto :fail)
if not exist "%PACKAGES_DIR%package.json" (set "FAILMSG=packages repo not found at %PACKAGES_DIR% - this .bat must sit inside the packages repo, or edit PACKAGES_DIR at the top" & goto :fail)
if not exist "%APP_DIR%\package.json" (set "FAILMSG=app repo not found - checked ..\DCMS and ..\RI_DOCMANAGER_UI next to this repo. Edit APP_DIR at the top of this file" & goto :fail)
node -e "const v=process.versions.node.split('.').map(Number);if(v[0]<22||(v[0]===22&&v[1]<14)){console.log('Found Node '+process.versions.node+' - these packages need 22.14.0 or newer');process.exit(1)}"
if errorlevel 1 (set "FAILMSG=Node.js is too old for these packages" & goto :fail)

rem ---- STEP 1: build and pack ----
echo [STEP 1/6] Build and pack: npm ci, npm run build, npm run pack
cd /d "%PACKAGES_DIR%"
set "FAILMSG=npm ci failed in the packages repo - see the npm output above"
call npm ci
if errorlevel 1 goto :fail
set "FAILMSG=npm run build failed in the packages repo - see the npm output above"
call npm run build
if errorlevel 1 goto :fail
set "FAILMSG=npm run pack failed in the packages repo - see the npm output above"
call npm run pack
if errorlevel 1 goto :fail
echo        Done.
echo.

rem ---- STEP 2: copy tarballs into vendor ----
echo [STEP 2/6] Copy fresh tarballs into the app vendor folder
if not exist "%PACKAGES_DIR%artifacts\*.tgz" (set "FAILMSG=no .tgz in artifacts - STEP 1 produced nothing" & goto :fail)
if not exist "%APP_DIR%\vendor" mkdir "%APP_DIR%\vendor"
copy /y "%PACKAGES_DIR%artifacts\*.tgz" "%APP_DIR%\vendor\" >nul
if errorlevel 1 (set "FAILMSG=copying tarballs into the app vendor folder failed" & goto :fail)
echo        Done.
echo.

rem ---- STEP 3: check the file:vendor specs ----
echo [STEP 3/6] Check the file:vendor specs in the app package.json
cd /d "%APP_DIR%"
set "ENGINE_FILE="
set "REACT_FILE="
for /f "delims=" %%S in ('node -e "const d=(require('./package.json').dependencies||{});for(const n of ['@dcms/form-rules','@dcms/form-rules-react']){const s=String(d[n]||'');console.log(s.indexOf('file:vendor/')===0?s.substring(12):'')}"') do if not defined ENGINE_FILE (set "ENGINE_FILE=%%S") else set "REACT_FILE=%%S"
if not defined ENGINE_FILE (set "FAILMSG=app package.json has no file:vendor spec for @dcms/form-rules - do STEP 3 of the guide" & goto :fail)
if not defined REACT_FILE (set "FAILMSG=app package.json has no file:vendor spec for @dcms/form-rules-react - do STEP 3 of the guide" & goto :fail)
if not exist "%APP_DIR%\vendor\%ENGINE_FILE%" (set "FAILMSG=vendor\%ENGINE_FILE% missing after copy - filename in package.json does not match artifacts" & goto :fail)
if not exist "%APP_DIR%\vendor\%REACT_FILE%" (set "FAILMSG=vendor\%REACT_FILE% missing after copy - filename in package.json does not match artifacts" & goto :fail)
fc /b "%PACKAGES_DIR%artifacts\%ENGINE_FILE%" "%APP_DIR%\vendor\%ENGINE_FILE%" >nul
if errorlevel 1 (set "FAILMSG=copied %ENGINE_FILE% differs from the artifact - copy problem" & goto :fail)
fc /b "%PACKAGES_DIR%artifacts\%REACT_FILE%" "%APP_DIR%\vendor\%REACT_FILE%" >nul
if errorlevel 1 (set "FAILMSG=copied %REACT_FILE% differs from the artifact - copy problem" & goto :fail)
echo        Specs OK: %ENGINE_FILE%
echo                %REACT_FILE%
echo.

rem ---- STEP 4: remove stale installs and build cache ----
echo [STEP 4/6] Remove stale node_modules\@dcms and node_modules\.cache
if exist "%APP_DIR%\node_modules\@dcms" rd /s /q "%APP_DIR%\node_modules\@dcms"
if exist "%APP_DIR%\node_modules\.cache" rd /s /q "%APP_DIR%\node_modules\.cache"
if exist "%APP_DIR%\node_modules\@dcms" (set "FAILMSG=could not delete node_modules\@dcms - stop the dev server and any editor, then retry" & goto :fail)
if exist "%APP_DIR%\node_modules\.cache" (set "FAILMSG=could not delete node_modules\.cache - stop the dev server, then retry" & goto :fail)
echo        Done.
echo.

rem ---- STEP 5: reinstall from the tarballs ----
echo [STEP 5/6] Reinstall from the vendor tarballs
cd /d "%APP_DIR%"
set "FAILMSG=npm install from the vendor tarballs failed - see the npm output above"
call npm install --save-exact "./vendor/%ENGINE_FILE%" "./vendor/%REACT_FILE%"
if not errorlevel 1 goto :step5ok
echo        [WARN] npm install failed - applying the guide fallback:
echo               node scripts\refresh-dcms-lock.js
if exist "scripts\refresh-dcms-lock.js" node scripts\refresh-dcms-lock.js
call npm install --save-exact "./vendor/%ENGINE_FILE%" "./vendor/%REACT_FILE%"
if errorlevel 1 goto :fail
:step5ok
echo        Done.
echo.

rem ---- STEP 6: verify fingerprints match ----
echo [STEP 6/6] Verify the install matches the vendor tarballs
call :verify
if errorlevel 1 (
  echo        [WARN] Fingerprint mismatch - applying fallback and reinstalling...
  if exist "scripts\refresh-dcms-lock.js" node scripts\refresh-dcms-lock.js
  set "FAILMSG=fallback reinstall still does not match the tarballs - see the npm output above"
  call npm install --save-exact "./vendor/%ENGINE_FILE%" "./vendor/%REACT_FILE%"
  if errorlevel 1 goto :fail
  call :verify
  if errorlevel 1 goto :fail
)
if defined MARKER (
  echo [EXTRA] Searching installed package for marker: %MARKER%
  findstr /s /m /c:"%MARKER%" "%APP_DIR%\node_modules\@dcms\form-rules-react\dist\*.js" >nul 2>nul
  if errorlevel 1 (set "FAILMSG=marker not found in the installed package - the new code did not land" & goto :fail)
  echo        Marker found in node_modules.
)
echo.

echo ============================================================
echo  ALL STEPS DONE - the DCMS app now has the fresh packages
echo ============================================================
if defined QUIET exit /b 0

choice /c BSX /m "  [B] production build   [S] dev server   [X] finish"
if errorlevel 3 goto :finished
if errorlevel 2 goto :startDev
if errorlevel 1 goto :buildApp
goto :finished

rem ---- optional: production build ----
:buildApp
echo.
echo [BUILD] react-scripts build with extra heap (8 GB^)
cd /d "%APP_DIR%"
set "NODE_OPTIONS=--max-old-space-size=8192"
set "FAILMSG=react-scripts build failed - see the output above"
call npx react-scripts build
set "NODE_OPTIONS="
if errorlevel 1 goto :fail
if defined MARKER (
  findstr /s /m /c:"%MARKER%" "%APP_DIR%\build\static\js\*.js" >nul 2>nul
  if errorlevel 1 (set "FAILMSG=build finished but the marker is not in the bundle" & goto :fail)
  echo [OK] marker is present in the built bundle.
)
goto :finished

rem ---- optional: dev server ----
:startDev
echo.
echo [DEV] starting the dev server - press Ctrl+C to stop it
cd /d "%APP_DIR%"
call npm start
goto :finished

:finished
echo.
echo  Finished. Press any key to close.
pause >nul
exit /b 0

:fail
echo.
echo ============================================================
echo  FAILED: %FAILMSG%
echo ============================================================
echo  See the output above for details.
if defined QUIET exit /b 1
pause
exit /b 1

rem ---- subroutine: check lockfile fingerprints vs vendor tarballs ----
:verify
node -e "const c=require('crypto'),f=require('fs');const L=JSON.parse(f.readFileSync('package-lock.json','utf8'));let bad=0;for(const n of ['@dcms/form-rules','@dcms/form-rules-react']){const e=L.packages['node_modules/'+n];const t=e&&e.resolved?String(e.resolved).replace(/^file:/,''):'';let ok=false;try{ok=!!t&&e.integrity==='sha512-'+c.createHash('sha512').update(f.readFileSync(t)).digest('base64')}catch(x){ok=false}console.log((ok?'[OK]   ':'[FAIL] ')+n+(ok?' matches '+t:' does not match '+t));if(!ok)bad++}process.exit(bad?1:0)"
exit /b %errorlevel%
