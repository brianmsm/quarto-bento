@echo off
setlocal
deno run --no-config --no-remote --no-npm --allow-read --allow-write --allow-run --allow-env --allow-net=127.0.0.1 "%~dp0..\runtime\src\cli.ts" %*
exit /b %errorlevel%
