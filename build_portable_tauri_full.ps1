# 视界智检 V2.0 — Tauri GPU+CPU 完整版免安装脚本
# 输出：包含 GPU/CUDA 与 CPU 运行库的完整便携目录，不生成 NSIS 安装器
# 用法：.\build_portable_tauri_full.ps1 [-Proxy http://127.0.0.1:10808]

param(
    [string]$Proxy = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$ViewRoot = Join-Path $ProjectRoot "view"
$OutputRoot = Join-Path $ProjectRoot "releases"
$PortableDir = Join-Path $OutputRoot "视界智检_Tauri_完整_免安装版"
$DistDir = Join-Path $ProjectRoot "dist_portable_tauri_full"
$BuildDir = Join-Path $ProjectRoot "build_tauri_full"
$ResourcesBackendDir = Join-Path $ViewRoot "resources\backend"
$BackendDir = $DistDir
$FullVenvPath = Join-Path $ProjectRoot ".venv"
$PythonExe = Join-Path $FullVenvPath "Scripts\python.exe"
$PyInstallerExe = Join-Path $FullVenvPath "Scripts\pyinstaller.exe"

function Invoke-Checked([string]$File, [string[]]$Arguments) {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "命令执行失败 ($LASTEXITCODE): $File $($Arguments -join ' ')" }
}

Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   视界智检 V2.0 — Tauri GPU+CPU 完整版     ║" -ForegroundColor Cyan
Write-Host "║   目标: 免安装便携目录，包含 GPU/CUDA 与 CPU     ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

if ($Proxy) {
    $env:HTTP_PROXY = $Proxy
    $env:HTTPS_PROXY = $Proxy
    $env:ALL_PROXY = $Proxy
    $env:http_proxy = $Proxy
    $env:https_proxy = $Proxy
    $env:all_proxy = $Proxy
    Write-Host "[代理] $Proxy" -ForegroundColor Gray
}

$env:CARGO_BUILD_JOBS = "1"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "未找到 Node.js" }
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw "未找到 Cargo，请先安装 Rust" }
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw "未找到 Python" }

if (-not (Test-Path -LiteralPath $PythonExe)) {
    Write-Host "[准备] 创建 GPU+CPU Python 环境..." -ForegroundColor Yellow
    Invoke-Checked "python" @('-m', 'venv', $FullVenvPath)
}

Write-Host "[1/5] 准备 GPU+CPU 后端环境..." -ForegroundColor Yellow
Invoke-Checked $PythonExe @('-m', 'pip', 'install', '--disable-pip-version-check', '-q', 'pyinstaller')
if (-not (Test-Path -LiteralPath $PyInstallerExe)) { throw "未找到 GPU+CPU PyInstaller: $PyInstallerExe" }

Write-Host "[2/5] 构建 GPU+CPU 完整 Python 后端..." -ForegroundColor Yellow
if (Test-Path -LiteralPath $DistDir) { Remove-Item -LiteralPath $DistDir -Recurse -Force }
if (Test-Path -LiteralPath $BuildDir) { Remove-Item -LiteralPath $BuildDir -Recurse -Force }
$pyinstallerLog = Join-Path $ProjectRoot "pyinstaller-build-tauri-full.log"
& $PythonExe -m PyInstaller (Join-Path $ProjectRoot "backend.spec") --clean --noconfirm --distpath $DistDir --workpath $BuildDir 2>&1 | Tee-Object -FilePath $pyinstallerLog
if ($LASTEXITCODE -ne 0) { throw "GPU+CPU PyInstaller 构建失败，详情见: $pyinstallerLog" }
if (Test-Path -LiteralPath (Join-Path $DistDir "backend" "backend.exe")) { $BackendDir = Join-Path $DistDir "backend" }
if (-not (Test-Path -LiteralPath (Join-Path $BackendDir "backend.exe"))) { throw "未找到 GPU+CPU backend.exe" }
Write-Host "  ✓ GPU+CPU 完整版 backend.exe 已生成" -ForegroundColor Green

Write-Host "[3/5] 准备便携版后端资源..." -ForegroundColor Yellow
if (Test-Path -LiteralPath $ResourcesBackendDir) { Remove-Item -LiteralPath $ResourcesBackendDir -Recurse -Force }
New-Item -ItemType Directory -Path $ResourcesBackendDir -Force | Out-Null
Copy-Item -Path (Join-Path $BackendDir '*') -Destination $ResourcesBackendDir -Recurse -Force
Write-Host "  ✓ $ResourcesBackendDir" -ForegroundColor Green

Write-Host "[4/5] 构建 React/Vite 和 Tauri 可执行文件..." -ForegroundColor Yellow
Push-Location $ViewRoot
try {
    Invoke-Checked "npm" @('run', 'build')
    Invoke-Checked "npm" @('run', 'tauri:prepare')
    Invoke-Checked "npx" @('tauri', 'build', '--no-bundle')
}
finally { Pop-Location }
$BuiltExe = Join-Path $ViewRoot "src-tauri\target\release\vision-inspection.exe"
if (-not (Test-Path -LiteralPath $BuiltExe)) { throw "未找到 Tauri 可执行文件: $BuiltExe" }
Write-Host "  ✓ $BuiltExe" -ForegroundColor Green

Write-Host "[5/5] 整理 GPU+CPU 完整版免安装目录..." -ForegroundColor Yellow
if (Test-Path -LiteralPath $PortableDir) { Remove-Item -LiteralPath $PortableDir -Recurse -Force }
New-Item -ItemType Directory -Path $PortableDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $PortableDir "resources\backend") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $PortableDir "data") -Force | Out-Null
Copy-Item -LiteralPath $BuiltExe -Destination (Join-Path $PortableDir "视界智检.exe") -Force
Copy-Item -Path (Join-Path $BackendDir '*') -Destination (Join-Path $PortableDir "resources\backend") -Recurse -Force
Set-Content -LiteralPath (Join-Path $PortableDir "portable.flag") -Value "Tauri GPU+CPU portable" -Encoding utf8

$readmeLines = @(
    '视界智检 V2.0 - Tauri GPU+CPU 完整版免安装版',
    '',
    '直接双击“视界智检.exe”即可自动启动前端和后端。'
    '程序、后端资源和 data 数据目录均位于当前目录，可整体复制或压缩分发。',
    '首次运行前请确认已安装海康 MVS SDK，并且 PLC 服务可用。'
)
[System.IO.File]::WriteAllLines((Join-Path $PortableDir "使用说明.txt"), $readmeLines, [System.Text.UTF8Encoding]::new($true))
$size = [math]::Round(((Get-ChildItem -LiteralPath $PortableDir -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)

if (Test-Path -LiteralPath $DistDir) { Remove-Item -LiteralPath $DistDir -Recurse -Force }
if (Test-Path -LiteralPath $BuildDir) { Remove-Item -LiteralPath $BuildDir -Recurse -Force }
if (Test-Path -LiteralPath $pyinstallerLog) { Remove-Item -LiteralPath $pyinstallerLog -Force }

Write-Host ""
Write-Host "✓ Tauri GPU+CPU 完整版免安装版打包完成" -ForegroundColor Green
Write-Host "目录: $PortableDir" -ForegroundColor White
Write-Host "启动: $(Join-Path $PortableDir '视界智检.exe')" -ForegroundColor White
Write-Host "大小: $size MB" -ForegroundColor White
