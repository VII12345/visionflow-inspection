# 视界智检 V2.0 — Tauri GPU+CPU 完整版安装包脚本
# 使用 backend.spec，包含 GPU/CUDA 与 CPU 运行库，生成 NSIS 安装包。
# 如果 GPU 版体积过大导致 NSIS 无法生成，可只使用 build_portable_tauri_full.ps1。
# 用法：.\build_installer_tauri_full.ps1 [-Proxy http://127.0.0.1:10808]

param(
    [string]$Proxy = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
. (Join-Path $ProjectRoot "scripts\build-common.ps1")
$ViewRoot = Join-Path $ProjectRoot "view"
$OutputRoot = Join-Path $ProjectRoot "releases"
$FinalDir = Join-Path $OutputRoot "视界智检_GPU_CPU_安装包"
$DistDir = Join-Path $ProjectRoot "dist_tauri_full_installer"
$BuildDir = Join-Path $ProjectRoot "build_tauri_full_installer"
$ResourcesBackendDir = Join-Path $ViewRoot "resources\backend"
$BackendDir = $DistDir
$VenvPath = Join-Path $ProjectRoot ".venv"
$PythonExe = Join-Path $VenvPath "Scripts\python.exe"


Set-BuildProxy -Proxy $Proxy

$env:CARGO_BUILD_JOBS = "1"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "未找到 Node.js" }
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw "未找到 Cargo，请先安装 Rust" }
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw "未找到 Python" }
if (-not (Test-Path -LiteralPath $PythonExe)) { Invoke-Checked "python" @('-m', 'venv', $VenvPath) }

Write-Host "[1/5] 准备 GPU+CPU Python 环境..." -ForegroundColor Yellow
Invoke-Checked $PythonExe @('-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', (Join-Path $ProjectRoot 'requirements-gpu.txt'), 'pyinstaller')

Write-Host "[2/5] 构建 GPU+CPU 完整后端..." -ForegroundColor Yellow
if (Test-Path -LiteralPath $DistDir) { Remove-Item -LiteralPath $DistDir -Recurse -Force }
if (Test-Path -LiteralPath $BuildDir) { Remove-Item -LiteralPath $BuildDir -Recurse -Force }
& $PythonExe -m PyInstaller (Join-Path $ProjectRoot 'backend.spec') --clean --noconfirm --distpath $DistDir --workpath $BuildDir
if ($LASTEXITCODE -ne 0) { throw 'GPU+CPU 后端构建失败' }
if (Test-Path -LiteralPath (Join-Path $DistDir 'backend' 'backend.exe')) { $BackendDir = Join-Path $DistDir 'backend' }
if (-not (Test-Path -LiteralPath (Join-Path $BackendDir 'backend.exe'))) { throw '未找到 GPU+CPU backend.exe' }

Write-Host "[3/5] 准备 Tauri 后端资源..." -ForegroundColor Yellow
if (Test-Path -LiteralPath $ResourcesBackendDir) { Remove-Item -LiteralPath $ResourcesBackendDir -Recurse -Force }
New-Item -ItemType Directory -Path $ResourcesBackendDir -Force | Out-Null
Copy-Item -Path (Join-Path $BackendDir '*') -Destination $ResourcesBackendDir -Recurse -Force

Write-Host "[3/5] 准备 LECPServer 资源..." -ForegroundColor Yellow
$LecpSource = Join-Path $ProjectRoot "resources\lecpserver"
$LecpTarget = Join-Path $ViewRoot "resources\lecpserver"
# 确保源 LECPServer 配置带长路径修复（重新拷贝厂商目录后需要重新应用）
Apply-LecpserverLongPathFix $LecpSource
if (Test-Path -LiteralPath $LecpSource) {
    if (Test-Path -LiteralPath $LecpTarget) { Remove-Item -LiteralPath $LecpTarget -Recurse -Force }
    Copy-Item -Path $LecpSource -Destination $LecpTarget -Recurse -Force
    Remove-Item -LiteralPath (Join-Path $LecpTarget "cache") -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $LecpTarget -Recurse -Filter '*.pdb' | Remove-Item -Force
    Write-Host "  ✓ $LecpTarget" -ForegroundColor Green
} else {
    Write-Host "  [警告] 未找到 resources\lecpserver，LECPServer 自动启动将不可用" -ForegroundColor Yellow
}

Write-Host "[4/5] 构建 Tauri NSIS 安装包..." -ForegroundColor Yellow
Push-Location $ViewRoot
try {
    Invoke-Checked 'npm' @('run', 'build')
    Copy-FrontendDist -ViewRoot $ViewRoot -BackendDir $BackendDir -ResourcesBackendDir $ResourcesBackendDir
    Invoke-Checked 'npm' @('run', 'tauri:prepare')
    Invoke-Checked 'npx' @('tauri', 'build', '--bundles', 'nsis')
}
finally { Pop-Location }

$bundleDir = Join-Path $ViewRoot 'src-tauri\target\release\bundle\nsis'
$installer = Get-ChildItem -LiteralPath $bundleDir -Filter '*.exe' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) { throw "未找到 Tauri NSIS 安装包: $bundleDir" }

Write-Host "[5/5] 整理发布结果..." -ForegroundColor Yellow
if (Test-Path -LiteralPath $FinalDir) { Remove-Item -LiteralPath $FinalDir -Recurse -Force }
New-Item -ItemType Directory -Path $FinalDir -Force | Out-Null
$finalInstaller = Join-Path $FinalDir '视界智检_GPU_CPU_Setup.exe'
Copy-Item -LiteralPath $installer.FullName -Destination $finalInstaller -Force
$size = [math]::Round(((Get-ChildItem -LiteralPath $FinalDir -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)

if (Test-Path -LiteralPath $DistDir) { Remove-Item -LiteralPath $DistDir -Recurse -Force }
if (Test-Path -LiteralPath $BuildDir) { Remove-Item -LiteralPath $BuildDir -Recurse -Force }

Write-Host "✓ GPU+CPU 完整版安装包生成成功" -ForegroundColor Green
Write-Host "安装包: $finalInstaller" -ForegroundColor White
Write-Host "大小: $size MB" -ForegroundColor White
