# 视界智检 — 打包版模拟相机测试脚本
#
# 用法（需用 pwsh 运行，见下方说明）：
#   pwsh -File scripts\build-packaged-sim.ps1             # 直接用现有打包版启动模拟相机
#   pwsh -File scripts\build-packaged-sim.ps1 -Build       # 先重新打包 CPU 免安装版，再带模拟相机启动
#   pwsh -File scripts\build-packaged-sim.ps1 -CameraCount 8 -IntervalMs 500
#
# 为什么要自我提权：
#   backend.exe 由 PyInstaller 冻结，不读取 PYTHONPATH；且视界智检.exe 整应用提权运行。
#   在普通 cmd 里先 set FAKE_MVS_DIR 再启动，环境变量跨不过 UAC 提权边界会丢失，
#   backend 仍走真实 MVS SDK（枚举到 0 台相机）。本脚本先自我提权（UAC），
#   在提权会话内设置 FAKE_MVS_DIR / FAKE_CAMERA_COUNT 等环境变量再启动应用，
#   backend 子进程即可继承到模拟相机配置。
#
# 注意：本脚本含中文路径，必须用 pwsh（PowerShell 7，默认 UTF-8）运行，
#   不要用 powershell 5.1（按 GBK 读取会解析失败）。

param(
    [switch]$Build,          # 是否先重新打包 CPU 免安装版（默认用现有 release）
    [string]$Proxy = "",     # 构建代理（透传给 build_portable_tauri.ps1）
    [int]$CameraCount = 4,   # 模拟相机台数
    [int]$IntervalMs = 2000  # 模拟触发间隔（毫秒）
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PortableDir = Join-Path $ProjectRoot 'releases\视界智检_Tauri_CPU_免安装版'
$AppExe = Join-Path $PortableDir '视界智检.exe'
$SimDir = Join-Path $ProjectRoot 'simulator'
$BuildScript = Join-Path $ProjectRoot 'build_portable_tauri.ps1'

# ---- 1. 自我提权（非管理员时通过 UAC 重新启动自身）----
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    Write-Host '需要管理员权限，正在触发 UAC 提权（请在弹窗中点「是」）...' -ForegroundColor Yellow
    $relaunchArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    if ($Build) { $relaunchArgs += '-Build' }
    if ($Proxy) { $relaunchArgs += "-Proxy", $Proxy }
    $relaunchArgs += "-CameraCount", "$CameraCount", "-IntervalMs", "$IntervalMs"
    Start-Process pwsh -ArgumentList $relaunchArgs -Verb RunAs -Wait
    exit 0
}

if (-not (Test-Path -LiteralPath $SimDir)) {
    throw "未找到模拟相机目录: $SimDir"
}

# ---- 2. 结束当前打包版进程（backend/LECPServer/视界智检.exe）----
Write-Host '[1/4] 结束现有打包版进程...' -ForegroundColor Yellow
Get-CimInstance Win32_Process |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath -like '*视界智检_Tauri_CPU_免安装版*' } |
    ForEach-Object {
        Write-Host "  结束 $($_.Name) (PID $($_.ProcessId))" -ForegroundColor Gray
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
Start-Sleep -Seconds 1

# ---- 3. 可选：重新打包 CPU 免安装版 ----
if ($Build) {
    Write-Host '[2/4] 重新打包 CPU 免安装版（约 5-10 分钟）...' -ForegroundColor Yellow
    & $BuildScript -Proxy $Proxy
    if ($LASTEXITCODE -ne 0) { throw "打包失败 (exit=$LASTEXITCODE)" }
} else {
    Write-Host '[2/4] 跳过打包，使用现有 release' -ForegroundColor Gray
}
if (-not (Test-Path -LiteralPath $AppExe)) {
    throw "未找到打包版应用: $AppExe（请先运行一次打包，或加 -Build）"
}

# ---- 4. 设置模拟相机环境变量并启动 ----
Write-Host '[3/4] 设置模拟相机环境变量...' -ForegroundColor Yellow
$env:FAKE_MVS_DIR = $SimDir
$env:FAKE_CAMERA_COUNT = "$CameraCount"
$env:FAKE_CAMERA_INTERVAL_MS = "$IntervalMs"

Write-Host '[4/4] 启动打包版（带模拟相机）...' -ForegroundColor Yellow
Start-Process -FilePath $AppExe

$ips = (0..($CameraCount - 1)) | ForEach-Object { "192.168.10.$($_ + 50)" }
Write-Host ''
Write-Host '✓ 打包版已带模拟相机启动' -ForegroundColor Green
Write-Host "  相机台数 : $CameraCount" -ForegroundColor White
Write-Host "  触发间隔 : $IntervalMs ms" -ForegroundColor White
Write-Host "  模拟 IP  : $($ips -join ', ')" -ForegroundColor White
Write-Host '  请在页面将相机 IP 配置为上述地址并启用后启动系统。' -ForegroundColor White
