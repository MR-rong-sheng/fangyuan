@echo off
chcp 936 >nul
title 方圆 · 数学练习 (本地 8082)
cd /d "%~dp0"
echo.
echo   方圆正在启动（本机 127.0.0.1 与局域网都听）：
echo     本机   http://127.0.0.1:8082/
echo   自带服务：Range、不列目录、多线程、账号与全站门禁、每账号操作存档。
echo   停止：关掉这个黑窗口，或按 Ctrl+C。
echo.
start "" "http://127.0.0.1:8082/"
python -u "%~dp0serve.py" 8082 "%~dp0" wg
echo.
echo   服务已停止。
pause
