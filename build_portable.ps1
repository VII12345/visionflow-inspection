# 视觉检测系统 V2.0 — 免安装便携版一键打包脚本
# 输出：单个 EXE 文件，双击即用，前后端全自动启动
# 用法：.\build_portable.ps1 [-Proxy http://127.0.0.1:10808]

param(
    [string]$Proxy = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$OutputDir = Join-Path $ProjectRoot "releases"
$DistDir = Join-Path $ProjectRoot "dist_portable"
$ResourcesDir = Join-Path $ProjectRoot "view\resources"
$BackendDir = Join-Path $ResourcesDir "backend"
$OldBuildDir = Join-Path $ProjectRoot "视觉检测系统_免安装版"

Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   视觉检测系统 V2.0 — 免安装版打包工具      ║" -ForegroundColor Cyan
Write-Host "║   目标: 生成单个 EXE，开箱即用              ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ========== 清理旧的构建残留 ==========
if (Test-Path $OldBuildDir) {
    Write-Host "[清理] 删除旧的构建文件夹..." -ForegroundColor Gray
    Remove-Item -Recurse -Force $OldBuildDir -ErrorAction SilentlyContinue
    Write-Host "  ✓ 已清理旧残留" -ForegroundColor Gray
}

# 确保输出目录存在
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

# ========== 代理设置 ==========
if ($Proxy) {
    Write-Host "[代理] 设置代理: $Proxy" -ForegroundColor Gray
    $env:HTTP_PROXY = $Proxy
    $env:HTTPS_PROXY = $Proxy
    $env:http_proxy = $Proxy
    $env:https_proxy = $Proxy
    $env:npm_config_proxy = $Proxy
    $env:npm_config_https_proxy = $Proxy
}

# ========== 步骤 1: 环境检查 ==========
Write-Host "[1/5] 检查环境..." -ForegroundColor Yellow

$pythonCmd = (Get-Command python -ErrorAction SilentlyContinue)
$nodeCmd = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $pythonCmd) { Write-Host "  X 未找到 Python，请先安装 Python 3.9+" -ForegroundColor Red; exit 1 }
if (-not $nodeCmd) { Write-Host "  X 未找到 Node.js，请先安装 Node.js 18+" -ForegroundColor Red; exit 1 }

Write-Host "  ✓ Python: $(python --version 2>&1)" -ForegroundColor Green
Write-Host "  ✓ Node:   $(node --version 2>&1)" -ForegroundColor Green

# 检查并激活虚拟环境
$venvPath = Join-Path $ProjectRoot ".venv"
if (Test-Path "$venvPath\Scripts\Activate.ps1") {
    & "$venvPath\Scripts\Activate.ps1"
    Write-Host "  ✓ 虚拟环境已激活" -ForegroundColor Green
}

# ========== 步骤 2: 构建前端 (Vite) ==========
Write-Host "`n[2/5] 构建前端 (React + Vite)..." -ForegroundColor Yellow

Push-Location (Join-Path $ProjectRoot "view")

# 安装前端依赖（如果缺少）
if (-not (Test-Path "node_modules\.package-lock.json")) {
    Write-Host "  安装前端依赖..." -ForegroundColor Gray
    npm install --no-audit --no-fund 2>&1 | Out-Null
}

# Vite 构建
Write-Host "  编译 TypeScript + 打包..." -ForegroundColor Gray
npx vite build 2>&1 | Out-Null

if (-not (Test-Path "dist\index.html")) {
    Write-Host "  X 前端构建失败" -ForegroundColor Red
    Pop-Location
    exit 1
}
Write-Host "  ✓ 前端构建完成" -ForegroundColor Green

Pop-Location

# ========== 步骤 3: 构建后端 (PyInstaller) ==========
Write-Host "`n[3/5] 构建后端 (PyInstaller)..." -ForegroundColor Yellow

# 确保 PyInstaller 已安装
$pythonExe = Join-Path $venvPath "Scripts\python.exe"
$pyinstallerExe = Join-Path $venvPath "Scripts\pyinstaller.exe"
if (-not (Test-Path $pyinstallerExe)) {
    Write-Host "  安装 PyInstaller..." -ForegroundColor Gray
    & $pythonExe -m pip install -q pyinstaller
}
if (-not (Test-Path $pyinstallerExe)) {
    Write-Host "  X 未找到 PyInstaller: $pyinstallerExe" -ForegroundColor Red
    exit 1
}

# 清理旧的构建产物
if (Test-Path $DistDir) { Remove-Item -Recurse -Force $DistDir }
if (Test-Path (Join-Path $ProjectRoot "build")) { Remove-Item -Recurse -Force (Join-Path $ProjectRoot "build") -ErrorAction SilentlyContinue }
if (Test-Path (Join-Path $ProjectRoot "__pycache__")) { Remove-Item -Recurse -Force (Join-Path $ProjectRoot "__pycache__") -ErrorAction SilentlyContinue }

Write-Host "  正在打包后端（全量 GPU 支持，可能需要几分钟）..." -ForegroundColor Gray
$pyinstallerLog = Join-Path $ProjectRoot "pyinstaller-build.log"
& $pythonExe -m PyInstaller backend.spec --clean --noconfirm --distpath $DistDir 2>&1 | Tee-Object -FilePath $pyinstallerLog
$pyinstallerExitCode = $LASTEXITCODE
if ($pyinstallerExitCode -ne 0) {
    Write-Host "  X PyInstaller 失败，退出码: $pyinstallerExitCode" -ForegroundColor Red
    Write-Host "  详细日志: $pyinstallerLog" -ForegroundColor Yellow
    exit 1
}

# onedir 模式：检查 backend 目录
$BackendDir = Join-Path $DistDir "backend"
$BackendExe = Join-Path $BackendDir "backend.exe"
if (-not (Test-Path $BackendExe)) {
    $BackendExe = Join-Path $DistDir "backend.exe"
    if (-not (Test-Path $BackendExe)) {
        Write-Host "  X 后端打包失败" -ForegroundColor Red
        exit 1
    }
}

$totalSize = if (Test-Path $BackendDir) {
    (Get-ChildItem $BackendDir -Recurse | Measure-Object Length -Sum).Sum
}
else {
    (Get-Item $BackendExe).Length
}
Write-Host "  ✓ 后端打包完成 ($([math]::Round($totalSize/1MB,1)) MB，完整 GPU 支持)" -ForegroundColor Green

# ========== 步骤 4: 组装资源 + Electron 便携目录 ==========
Write-Host "`n[4/5] 打包 Electron 便携目录（不生成安装包）..." -ForegroundColor Yellow

# 准备 resources 目录
$ResourcesBackendDir = Join-Path $ProjectRoot "view\resources\backend"
if (Test-Path $ResourcesBackendDir) { Remove-Item -Recurse -Force $ResourcesBackendDir }
New-Item -ItemType Directory -Path $ResourcesBackendDir -Force | Out-Null

# 复制整个后端目录
if (Test-Path $BackendDir) {
    Copy-Item "$BackendDir\*" -Destination $ResourcesBackendDir -Recurse -Force
    Write-Host "  ✓ 复制后端目录 ($([math]::Round($totalSize/1MB,1)) MB)" -ForegroundColor Gray
}
else {
    Copy-Item $BackendExe -Destination (Join-Path $ResourcesBackendDir "backend.exe") -Force
    Write-Host "  ✓ 复制 backend.exe" -ForegroundColor Gray
}

# 复制模型文件
$modelPath = Join-Path $ProjectRoot "jar_classifier.pth"
if (Test-Path $modelPath) {
    Copy-Item $modelPath -Destination (Join-Path $ProjectRoot "view\resources\jar_classifier.pth") -Force
    Write-Host "  ✓ 复制 jar_classifier.pth" -ForegroundColor Gray
}

if (-not (Test-Path (Join-Path $ProjectRoot "view\assets\icon.png"))) {
    New-Item -ItemType Directory -Path (Join-Path $ProjectRoot "view\assets") -Force | Out-Null
    Write-Host "  ! 未找到 icon.png，将使用默认图标" -ForegroundColor Yellow
}

Push-Location (Join-Path $ProjectRoot "view")
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$ebOutput = "release_$ts"

# 只生成 win-unpacked，避免 NSIS 处理超过 2GB 的压缩包失败。
Write-Host "  正在生成便携运行目录（全量 GPU 版，可能需要几分钟）..." -ForegroundColor Gray
npx electron-builder --win --dir --config.directories.output=$ebOutput 2>&1 | Select-Object -Last 8
Pop-Location

$releaseDir = Join-Path $ProjectRoot "view\$ebOutput\win-unpacked"
$builtExe = Join-Path $releaseDir "视觉检测系统.exe"
if (-not (Test-Path $builtExe)) {
    Write-Host "  X Electron 便携目录构建失败" -ForegroundColor Red
    Get-ChildItem (Join-Path $ProjectRoot "view\$ebOutput") -Recurse -ErrorAction SilentlyContinue | Select-Object FullName | ForEach-Object { Write-Host "    $($_.FullName)" -ForegroundColor Gray }
    exit 1
}
Write-Host "  ✓ Electron 便携目录完成: $builtExe" -ForegroundColor Green

# ========== 步骤 5: 输出 ==========
Write-Host "`n[5/5] 整理便携版输出..." -ForegroundColor Yellow

# Electron 程序必须和 resources、DLL、locales 等文件一起运行，不能只复制主 EXE。
$finalDir = Join-Path $OutputDir "视觉检测系统_免安装版"
if (Test-Path $finalDir) {
    Remove-Item $finalDir -Recurse -Force
}
New-Item -ItemType Directory -Path $finalDir -Force | Out-Null
Copy-Item "$releaseDir\*" -Destination $finalDir -Recurse -Force
$finalExe = Join-Path $finalDir "视觉检测系统.exe"
$finalSize = [math]::Round(((Get-ChildItem $finalDir -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)

# 生成一键启动脚本
Write-Host "  生成启动脚本..." -ForegroundColor Gray
$batContent = @'
@echo off
chcp 65001 >nul
title 视觉检测系统 V2.0

echo ============================================
echo          视觉检测系统 V2.0 一键启动
echo ============================================
echo.

echo [1/3] 正在启动检测引擎...
start "" /B "resources\backend\backend.exe"

echo [2/3] 等待后端就绪...
set /a count=0
:wait_health
timeout /t 1 /nobreak >nul
set /a count+=1

powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:5000/api/health' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 goto backend_ready
if %count% geq 20 goto backend_timeout
echo    等待中... (%count%s)
goto wait_health

:backend_timeout
echo [错误] 后端启动超时！请检查：
echo   1. backend.exe 是否存在
echo   2. 端口 5000 是否被占用
echo   3. 杀毒软件是否拦截
echo.
pause
exit /b 1

:backend_ready
echo [2/3] 后端已就绪 (耗时 %count%s)

echo [3/3] 启动前端界面...
start "" "视觉检测系统.exe"

echo.
echo ============================================
echo   系统已启动！
echo   关闭前端窗口后，请手动关闭后端进程
echo   (或直接关闭此窗口自动清理)
echo ============================================

:wait_electron
timeout /t 3 /nobreak >nul
tasklist /FI "IMAGENAME eq 视觉检测系统.exe" 2>NUL | find /I "视觉检测系统.exe" >NUL
if %errorlevel% equ 0 goto wait_electron

echo 正在关闭后端...
taskkill /F /IM backend.exe >nul 2>&1
echo 系统已完全关闭。
exit /b 0
'@
$batPath = Join-Path $finalDir "启动系统.bat"
[System.IO.File]::WriteAllText($batPath, $batContent, [System.Text.UTF8Encoding]::new($true))
Write-Host "  ✓ 启动脚本已生成: 启动系统.bat" -ForegroundColor Gray

# 清理临时构建目录
Write-Host "  清理临时文件..." -ForegroundColor Gray
if (Test-Path $DistDir) { Remove-Item -Recurse -Force $DistDir }
if (Test-Path (Join-Path $ProjectRoot "build")) { Remove-Item -Recurse -Force (Join-Path $ProjectRoot "build") -ErrorAction SilentlyContinue }
if (Test-Path (Join-Path $ProjectRoot "__pycache__")) { Remove-Item -Recurse -Force (Join-Path $ProjectRoot "__pycache__") -ErrorAction SilentlyContinue }
if (Test-Path (Join-Path $ProjectRoot "view\$ebOutput")) { Remove-Item (Join-Path $ProjectRoot "view\$ebOutput") -Recurse -Force -ErrorAction SilentlyContinue }

# 完成
Write-Host "`n╔══════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║   ✓ 便携版打包完成！                         ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "   📦 运行目录: $finalDir" -ForegroundColor White
Write-Host "   🚀 启动文件: $finalExe" -ForegroundColor White
Write-Host "   📏 目录大小: $finalSize MB" -ForegroundColor White
Write-Host ""
Write-Host "   使用方法：将整个“视觉检测系统_免安装版”目录复制或压缩后分发，运行其中的“视觉检测系统.exe”。" -ForegroundColor Cyan
Write-Host ""
