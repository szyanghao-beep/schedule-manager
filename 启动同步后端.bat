@echo off
rem 日程管理同步后端 一键启动脚本（Windows）
rem 双击本文件即启动后端服务，监听 0.0.0.0:8787
chcp 65001 >nul
cd /d "%~dp0server"
echo 正在启动日程管理同步后端...
echo   监听地址: http://0.0.0.0:8787
echo   电脑端填: http://127.0.0.1:8787
echo   手机端填: http://电脑局域网IP:8787
echo.
echo 按 Ctrl+C 停止服务
echo.
node server.js
pause
