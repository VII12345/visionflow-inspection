# 视界智检 V2.0 — Tauri GPU+CPU 完整版免安装脚本
# 输出：包含 GPU/CUDA 与 CPU 运行库的完整便携目录，不生成 NSIS 安装器
# 用法：.\build_portable_tauri_full.ps1 [-Proxy http://127.0.0.1:10808]

param(
    [string]$Proxy = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
. (Join-Path $ProjectRoot "scripts\build-common.ps1")
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


Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   视界智检 V2.0 — Tauri GPU+CPU 完整版     ║" -ForegroundColor Cyan
Write-Host "║   目标: 免安装便携目录，包含 GPU/CUDA 与 CPU     ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

Set-BuildProxy -Proxy $Proxy

$env:CARGO_BUILD_JOBS = "1"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "未找到 Node.js" }
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw "未找到 Cargo，请先安装 Rust" }
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw "未找到 Python" }

if (-not (Test-Path -LiteralPath $PythonExe)) {
    Write-Host "[准备] 创建 GPU+CPU Python 环境..." -ForegroundColor Yellow
    Invoke-Checked "python" @('-m', 'venv', $FullVenvPath)
}

Write-Host "[1/5] 准备 GPU+CPU 后端环境..." -ForegroundColor Yellow
# 安装运行依赖（含 psutil，硬件信息采集必需）+ PyInstaller，避免打包产物缺少依赖导致设置页设备信息异常。
Invoke-Checked $PythonExe @('-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', (Join-Path $ProjectRoot 'requirements-gpu.txt'), 'pyinstaller')
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

Write-Host "[3/5] 准备 LECPServer 资源..." -ForegroundColor Yellow
$LecpSource = Join-Path $ProjectRoot "resources\lecpserver"
$LecpTarget = Join-Path $ViewRoot "resources\lecpserver"
if (Test-Path -LiteralPath $LecpSource) {
    if (Test-Path -LiteralPath $LecpTarget) { Remove-Item -LiteralPath $LecpTarget -Recurse -Force }
    Copy-Item -Path $LecpSource -Destination $LecpTarget -Recurse -Force
    Remove-Item -LiteralPath (Join-Path $LecpTarget "cache") -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $LecpTarget -Recurse -Filter '*.pdb' | Remove-Item -Force
    Write-Host "  ✓ $LecpTarget" -ForegroundColor Green
} else {
    Write-Host "  [警告] 未找到 resources\lecpserver，LECPServer 自动启动将不可用" -ForegroundColor Yellow
}

Write-Host "[4/5] 构建 React/Vite 和 Tauri 可执行文件..." -ForegroundColor Yellow
Push-Location $ViewRoot
try {
    Invoke-Checked "npm" @('run', 'build')
    Copy-FrontendDist -ViewRoot $ViewRoot -BackendDir $BackendDir -ResourcesBackendDir $ResourcesBackendDir
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
if (Test-Path -LiteralPath $LecpSource) {
    New-Item -ItemType Directory -Path (Join-Path $PortableDir "resources\lecpserver") -Force | Out-Null
    Copy-Item -Path (Join-Path $LecpSource '*') -Destination (Join-Path $PortableDir "resources\lecpserver") -Recurse -Force
}
Set-Content -LiteralPath (Join-Path $PortableDir "portable.flag") -Value "Tauri GPU+CPU portable" -Encoding utf8

$readmeLines = @(
    '视界智检 V2.0 - Tauri GPU+CPU 完整版免安装版',
    '',
    '直接双击“视界智检.exe”即可自动启动前端和后端。'
    '程序、后端资源和 data 数据目录均位于当前目录，可整体复制或压缩分发。',
    '首次运行前请确认已安装海康 MVS SDK；PLC 服务由程序自动启动。'
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
