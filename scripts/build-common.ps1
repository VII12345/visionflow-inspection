# Shared helpers for Windows build entry points.

function Invoke-Checked([string]$File, [string[]]$Arguments) {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "命令执行失败 ($LASTEXITCODE): $File $($Arguments -join ' ')"
    }
}

function Set-BuildProxy([string]$Proxy) {
    if (-not $Proxy) { return }
    $env:HTTP_PROXY = $Proxy
    $env:HTTPS_PROXY = $Proxy
    $env:ALL_PROXY = $Proxy
    $env:http_proxy = $Proxy
    $env:https_proxy = $Proxy
    $env:all_proxy = $Proxy
    $env:npm_config_proxy = $Proxy
    $env:npm_config_https_proxy = $Proxy
    Write-Host "[代理] $Proxy" -ForegroundColor Gray
}

function Get-DirectorySizeMiB([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    $sum = (Get-ChildItem -LiteralPath $Path -Recurse -File | Measure-Object Length -Sum).Sum
    return [math]::Round($sum / 1MB, 1)
}

<#
.SYNOPSIS
断言 CPU-only 后端产物不包含 GPU/CUDA DLL，否则中止构建。
#>
function Assert-NoGpuDll([string]$BackendDir) {
    $gpuDllPattern = '^(torch_cuda|c10_cuda|cublas|cudnn|cudart|nvrtc|caffe2_nvrtc).*\.dll$'
    $gpuDlls = Get-ChildItem -LiteralPath $BackendDir -Recurse -File | Where-Object { $_.Name -match $gpuDllPattern }
    if ($gpuDlls) { throw "CPU-only 包检测到 GPU DLL: $(($gpuDlls.Name -join ', '))" }
}

<#
.SYNOPSIS
把前端构建产物 dist/ 复制到后端资源目录，让打包后的 Flask 后端能直接向浏览器
提供网页访问（http://<host>:5000/）。必须在 npm run build 之后调用。
#>
function Copy-FrontendDist([string]$ViewRoot, [string]$BackendDir, [string]$ResourcesBackendDir) {
    $webDist = Join-Path $ViewRoot 'dist'
    if (-not (Test-Path -LiteralPath (Join-Path $webDist 'index.html'))) {
        throw "未找到前端构建产物: $webDist（请先执行 npm run build）"
    }
    foreach ($target in @($BackendDir, $ResourcesBackendDir) | Select-Object -Unique) {
        if (-not $target -or -not (Test-Path -LiteralPath $target)) { continue }
        $dest = Join-Path $target 'dist'
        if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
        Copy-Item -LiteralPath $webDist -Destination $dest -Recurse -Force
        Write-Host "  ✓ 前端 dist 已复制到后端资源: $dest" -ForegroundColor Green
    }
}

<#
.SYNOPSIS
给 LECPServer.exe.config 打上关闭 .NET 长路径阻断的开关，幂等。

LECPServer v3.9.23.9 内嵌 CefSharp 的资源处理器会对超过 248 字符的模板 URL 调
Path.GetDirectoryName，触发 PathTooLongException 导致启动即崩。通过
AppContextSwitchOverrides 关闭长路径阻断即可避免。resources/lecpserver 是 gitignore
的厂商捆绑目录，此修复需在每次打包时重新应用，避免重新拷贝源目录后丢失。
#>
function Apply-LecpserverLongPathFix([string]$LecpDir) {
    $config = Join-Path $LecpDir 'LECPServer.exe.config'
    if (-not (Test-Path -LiteralPath $config)) {
        Write-Host "  [跳过] 未找到 $config（LECPServer 配置缺失）" -ForegroundColor Yellow
        return
    }
    $marker = 'Switch.System.IO.BlockLongPaths=false'
    $content = Get-Content -LiteralPath $config -Raw -Encoding UTF8
    if ($content -like "*$marker*") {
        Write-Host "  ✓ LECPServer 长路径修复已存在" -ForegroundColor Green
        return
    }
    $line = '    <AppContextSwitchOverrides value="Switch.System.IO.UseLegacyPathHandling=false;Switch.System.IO.BlockLongPaths=false" />'
    if ($content -match '(?m)^  <runtime>\r?\n') {
        $content = $content -replace '(?m)^  <runtime>\r?\n', "  <runtime>`r`n$line`r`n"
        [System.IO.File]::WriteAllText($config, $content, (New-Object System.Text.UTF8Encoding($true)))
        Write-Host "  ✓ 已应用 LECPServer 长路径修复" -ForegroundColor Green
    } else {
        Write-Host "  [警告] LECPServer 配置未找到 <runtime> 节点，跳过长路径修复" -ForegroundColor Yellow
    }
}
