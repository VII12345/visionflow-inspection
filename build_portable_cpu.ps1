# 视觉检测系统 V2.0 — CPU-only 免安装便携版一键打包脚本
# 输出：仅 CPU PyTorch 的 Electron 便携目录；不携带 CUDA/cuDNN DLL。
# 用法：.\build_portable_cpu.ps1 [-Proxy http://127.0.0.1:10808]
# GPU 版请继续使用 build_portable.ps1。

param([string]$Proxy = "")

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$OutputDir = Join-Path $ProjectRoot "releases"
$DistDir = Join-Path $ProjectRoot "dist_portable_cpu"
$BuildDir = Join-Path $ProjectRoot "build_cpu"
$CpuVenvPath = Join-Path $ProjectRoot ".venv_cpu"
$ResourcesBackendDir = Join-Path $ProjectRoot "view\resources\backend"
$CpuTorchIndex = "https://download.pytorch.org/whl/cpu"

function Get-DirectorySizeMiB([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    $sum = (Get-ChildItem -LiteralPath $Path -Recurse -File | Measure-Object Length -Sum).Sum
    return [math]::Round($sum / 1MB, 1)
}

Write-Host "[1/5] 准备独立的 CPU-only Python 环境..." -ForegroundColor Yellow
if ($Proxy) {
    $env:HTTP_PROXY = $Proxy; $env:HTTPS_PROXY = $Proxy
    $env:http_proxy = $Proxy; $env:https_proxy = $Proxy
    $env:npm_config_proxy = $Proxy; $env:npm_config_https_proxy = $Proxy
}
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw "未找到 Python 3.9+" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "未找到 Node.js 18+" }
if (-not (Test-Path -LiteralPath (Join-Path $CpuVenvPath "Scripts\python.exe"))) {
    python -m venv $CpuVenvPath
}
$pythonExe = Join-Path $CpuVenvPath "Scripts\python.exe"
& $pythonExe -m pip install --disable-pip-version-check -q --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip 升级失败" }
& $pythonExe -m pip install --disable-pip-version-check -q -r (Join-Path $ProjectRoot "requirements.txt") pyinstaller
if ($LASTEXITCODE -ne 0) { throw "CPU 构建依赖安装失败" }
# 关键：仅从 CPU wheel 索引安装，绝不复用项目现有的 GPU .venv。
& $pythonExe -m pip install --disable-pip-version-check -q --upgrade --force-reinstall --index-url $CpuTorchIndex --extra-index-url https://pypi.org/simple torch torchvision
if ($LASTEXITCODE -ne 0) { throw "CPU PyTorch 安装失败" }
$cpuInfo = & $pythonExe -c "import torch, torchvision; assert torch.version.cuda is None, 'GPU PyTorch was installed'; assert not torch.cuda.is_available(), 'CUDA unexpectedly available'; print(f'torch={torch.__version__}; torchvision={torchvision.__version__}; cuda={torch.version.cuda}')"
if ($LASTEXITCODE -ne 0) { throw "CPU PyTorch 验证失败" }
Write-Host "  ✓ $cpuInfo" -ForegroundColor Green

Write-Host "[2/5] 构建前端 (React + Vite)..." -ForegroundColor Yellow
Push-Location (Join-Path $ProjectRoot "view")
try {
    if (-not (Test-Path -LiteralPath "node_modules\.package-lock.json")) { npm install --no-audit --no-fund }
    npx vite build
    if ($LASTEXITCODE -ne 0) { throw "Vite 构建失败" }
    if (-not (Test-Path -LiteralPath "dist\index.html")) { throw "前端构建未生成 dist\\index.html" }
}
finally { Pop-Location }

Write-Host "[3/5] 构建 CPU-only 后端 (PyInstaller)..." -ForegroundColor Yellow
if (Test-Path -LiteralPath $DistDir) { Remove-Item -LiteralPath $DistDir -Recurse -Force }
if (Test-Path -LiteralPath $BuildDir) { Remove-Item -LiteralPath $BuildDir -Recurse -Force }
$pyinstallerLog = Join-Path $ProjectRoot "pyinstaller-build-cpu.log"
& $pythonExe -m PyInstaller backend_cpu.spec --clean --noconfirm --distpath $DistDir --workpath $BuildDir 2>&1 | Tee-Object -FilePath $pyinstallerLog
if ($LASTEXITCODE -ne 0) { throw "PyInstaller 失败，详情见: $pyinstallerLog" }
$BackendDir = Join-Path $DistDir "backend"
$BackendExe = Join-Path $BackendDir "backend.exe"
if (-not (Test-Path -LiteralPath $BackendExe)) { throw "CPU 后端打包失败：未找到 backend.exe" }
$gpuDllPattern = '^(torch_cuda|c10_cuda|cublas|cudnn|cudart|nvrtc|caffe2_nvrtc).*\.dll$'
$gpuDlls = Get-ChildItem -LiteralPath $BackendDir -Recurse -File | Where-Object { $_.Name -match $gpuDllPattern }
if ($gpuDlls) { throw "CPU 包检测到 GPU DLL，已终止发布: $(($gpuDlls.Name -join ', '))" }
$backendSize = Get-DirectorySizeMiB $BackendDir
Write-Host "  ✓ CPU 后端完成 ($backendSize MB，未检测到 CUDA DLL)" -ForegroundColor Green

Write-Host "[4/5] 组装 Electron CPU-only 便携目录..." -ForegroundColor Yellow
if (Test-Path -LiteralPath $ResourcesBackendDir) { Remove-Item -LiteralPath $ResourcesBackendDir -Recurse -Force }
New-Item -ItemType Directory -Path $ResourcesBackendDir -Force | Out-Null
Copy-Item (Join-Path $BackendDir '*') -Destination $ResourcesBackendDir -Recurse -Force
Push-Location (Join-Path $ProjectRoot "view")
try {
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $electronOutput = "release_cpu_$timestamp"
    npx electron-builder --win --dir --config.directories.output=$electronOutput
    if ($LASTEXITCODE -ne 0) { throw "Electron Builder 构建失败" }
    $releaseDir = Join-Path $ProjectRoot "view\$electronOutput\win-unpacked"
    $builtExe = Join-Path $releaseDir "视觉检测系统.exe"
    if (-not (Test-Path -LiteralPath $builtExe)) { throw "Electron 打包失败：未找到 $builtExe" }
    Write-Host "[5/5] 整理 CPU-only 输出..." -ForegroundColor Yellow
    $finalDir = Join-Path $OutputDir "视觉检测系统_CPU_免安装版"
    if (Test-Path -LiteralPath $finalDir) { Remove-Item -LiteralPath $finalDir -Recurse -Force }
    New-Item -ItemType Directory -Path $finalDir -Force | Out-Null
    Copy-Item (Join-Path $releaseDir '*') -Destination $finalDir -Recurse -Force
}
finally { Pop-Location }

$batLines = @('@echo off', 'chcp 65001 >nul', 'title 视觉检测系统 V2.0 (CPU-only)', 'echo 正在启动 CPU-only 视觉检测系统...', 'start "" "视觉检测系统.exe"')
$batPath = Join-Path $finalDir "启动系统_CPU版.bat"
[System.IO.File]::WriteAllLines($batPath, $batLines, [System.Text.UTF8Encoding]::new($true))
$finalSize = Get-DirectorySizeMiB $finalDir
Write-Host "✓ CPU-only 便携版打包完成：$finalDir ($finalSize MB)" -ForegroundColor Green

# 清理临时构建目录；保留 .venv_cpu，供下次 CPU 打包复用。
if (Test-Path -LiteralPath $DistDir) { Remove-Item -LiteralPath $DistDir -Recurse -Force }
if (Test-Path -LiteralPath $BuildDir) { Remove-Item -LiteralPath $BuildDir -Recurse -Force }
if (Test-Path -LiteralPath (Join-Path $ProjectRoot "view\$electronOutput")) { Remove-Item -LiteralPath (Join-Path $ProjectRoot "view\$electronOutput") -Recurse -Force }