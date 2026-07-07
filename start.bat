@echo off
chcp 65001 >nul
setlocal

REM 切换到 bat 文件所在目录（项目根目录）
cd /d "%~dp0"

echo ============================================
echo   Pixel Dart 启动脚本
echo ============================================
echo.

REM 检查是否安装了 Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org
    pause
    exit /b 1
)

REM 检查 node_modules 是否存在，不存在则自动安装依赖
if not exist "node_modules" (
    echo [信息] 首次运行，正在安装依赖...
    call npm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络或手动运行 npm install
        pause
        exit /b 1
    )
    echo.
)

echo [信息] 正在启动开发服务器...
echo [信息] 本地访问：http://localhost:4173
echo [信息] 按 Ctrl+C 可停止服务器
echo.

call npm run dev

pause
