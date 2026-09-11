<#
.SYNOPSIS
    One-shot phone notification via ntfy.sh. No state.
.EXAMPLE
    .\notify.ps1 -Type success -Title "job done" -Message "all green"
#>
param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$Message,
    [ValidateSet('min','low','default','high','urgent')][string]$Priority = 'default',
    [ValidateSet('success','blocked','decision')][string]$Type = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$config = Get-PingConfig
$Topic = $config.outboundTopic

switch ($Type) {
    'success'  { $Title = [char]::ConvertFromUtf32(0x2705) + ' ' + $Title }
    'blocked'  { $Title = [char]::ConvertFromUtf32(0x26A0) + [char]::ConvertFromUtf32(0xFE0F) + ' ' + $Title }
    'decision' { $Title = [char]::ConvertFromUtf32(0x2753) + ' ' + $Title }
}
$map = @{ min = 1; low = 2; default = 3; high = 4; urgent = 5 }
$body = @{ topic = $Topic; title = $Title; message = $Message; priority = $map[$Priority] } | ConvertTo-Json
$tmp = Join-Path $env:TEMP ("ping-" + [guid]::NewGuid().ToString('N') + ".json")
[System.IO.File]::WriteAllText($tmp, $body, (New-Object System.Text.UTF8Encoding($false)))
try {
    $out = & curl.exe -s --max-time 20 -w "`nHTTP %{http_code}" -H "Content-Type: application/json" --data-binary "@$tmp" "https://ntfy.sh" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "curl exited $LASTEXITCODE : $out" }
    $status = ($out -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^HTTP \d{3}$' } | Select-Object -Last 1)
    if (-not $status -or $status -notmatch '^HTTP 2\d\d$') { throw "ntfy returned $status" }
    Write-Output "OK: notification accepted '$Title'"
} finally { if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force } }
