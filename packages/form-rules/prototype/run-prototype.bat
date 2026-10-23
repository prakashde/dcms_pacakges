@echo off
cd /d "%~dp0"
start "" "http://localhost:32190/prototype/"
node server.mjs
