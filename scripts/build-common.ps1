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
