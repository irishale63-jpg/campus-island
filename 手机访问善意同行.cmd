@echo off
setlocal
cd /d "%~dp0"
title Campus Kindness - Phone Preview
set "LAN=1"
set "CAMPUS_NODE=node"
if exist "%ProgramFiles%\nodejs\node.exe" set "CAMPUS_NODE=%ProgramFiles%\nodejs\node.exe"
"%CAMPUS_NODE%" scripts\launch.mjs
if errorlevel 1 pause
