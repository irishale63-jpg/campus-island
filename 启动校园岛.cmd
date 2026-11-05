@echo off
setlocal
cd /d "%~dp0"
title Campus Island
set "CAMPUS_NODE=node"
if exist "%ProgramFiles%\nodejs\node.exe" set "CAMPUS_NODE=%ProgramFiles%\nodejs\node.exe"
"%CAMPUS_NODE%" src\scripts\launch.mjs
if errorlevel 1 pause
