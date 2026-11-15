@echo off
cd /d "%~dp0"
if not exist node_modules (echo Installo le dipendenze... & call npm install)
call npm start
pause
