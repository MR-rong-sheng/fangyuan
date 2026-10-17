@echo off
chcp 936 >nul
rem 方圆 · 开机自启：拉本地服务（含局域网绑定），没有公网穿透。
rem 不想开机自启：删掉启动文件夹里的「方圆.lnk」即可。
cd /d "%~dp0"
curl -s -o NUL -m 3 http://127.0.0.1:8082/ && goto end
start "fangyuan-serve" /min cmd /c "python -u "%~dp0serve.py" 8082 "%~dp0" wg"
:end
