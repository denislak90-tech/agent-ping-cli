<#
.SYNOPSIS
    Ask a 2-3 option question on your phone. Queues if one is already pending.
.EXAMPLE
    .\ask-decision.ps1 -TaskName "deploy" -Question "Ship v1.0 now?" -Options "Ship,Hold,Changelog first"
#>
param(
    [Parameter(Mandatory = $true)][string]$TaskName,
    [Parameter(Mandatory = $true)][string]$Question,
    [Parameter(Mandatory = $true)][string]$Options,
    [ValidateSet('min','low','default','high','urgent')][string]$Priority = 'high',
    [ValidateRange(1, 43200)][int]$ExpiryMinutes = 720
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$config = Get-PingConfig
$outbound = $config.outboundTopic; $reply = $config.replyTopic
if ($TaskName -match '[\r\n]' -or $Question -match '[\r\n]') { throw 'TaskName and Question cannot contain line breaks.' }

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$b = New-Object byte[] 8; $rng.GetBytes($b)
$id = ($b | ForEach-Object { $_.ToString('x2') }) -join ''
$map = @{ min = 1; low = 2; default = 3; high = 4; urgent = 5 }; $pnum = $map[$Priority]
$opts = @($Options -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
if ($opts.Count -lt 2) { throw 'Provide at least 2 comma-separated options.' }
if ($opts.Count -gt 3) { throw 'Provide no more than 3 comma-separated options.' }
if (@($opts | Where-Object { $_ -match '[\r\n]' -or $_ -eq '' }).Count -gt 0) { throw 'Options cannot contain line breaks or empty values.' }

if (-not (Enter-PingLock -TimeoutSeconds 30)) { Write-Error "lock busy"; exit 3 }
$expires = ''
try {
    $s = Read-PingState; if (-not $s.decisions) { $s.decisions = @() }
    foreach ($existing in @($s.decisions)) {
        if ($existing.status -eq 'pending' -and $existing.expiresAt) {
            try {
                if ([datetime]::Parse($existing.expiresAt) -lt (Get-Date)) { $existing.status = 'expired' }
            } catch { $existing.status = 'expired' }
        }
    }
    $pend = @($s.decisions | Where-Object { $_.status -eq 'pending' })
    if ($pend.Count -gt 0) {
        $s.decisions += [pscustomobject]@{ decisionId = $id; task = $TaskName; question = $Question; options = $opts; createdAt = (Get-Date).ToString('o'); status = 'waiting'; waitsFor = $pend[0].decisionId; expiryMinutes = $ExpiryMinutes; priority = $pnum; response = $null }
        Write-PingState $s; Write-Output "WAITING: queued behind $($pend[0].decisionId)"; Write-Output "DECISION_ID=$id"; exit 2
    }
    $expires = (Get-Date).AddMinutes($ExpiryMinutes).ToString('o')
    $s.decisions += [pscustomobject]@{ decisionId = $id; task = $TaskName; question = $Question; options = $opts; createdAt = (Get-Date).ToString('o'); expiresAt = $expires; status = 'pending'; priority = $pnum; response = $null }
    Write-PingState $s
} finally { Exit-PingLock }

try {
    Send-PingDecision -DecisionId $id -TaskName $TaskName -Question $Question -Options $opts -OutboundTopic $outbound -ReplyTopic $reply -PriorityNum $pnum | Out-Null
    Write-Output "OK: decision sent"; Write-Output "DECISION_ID=$id"; Write-Output "EXPIRES=$expires"
}
catch {
    if (Enter-PingLock -TimeoutSeconds 30) {
        try {
            $s = Read-PingState
            $s.decisions = @($s.decisions | Where-Object { $_.decisionId -ne $id })
            try {
                $promoted = Promote-PingWaiting -State $s -OutboundTopic $outbound -ReplyTopic $reply -PriorityNum $pnum
                if ($promoted) { Write-Output "PROMOTED_WAITING: $($promoted.decisionId) -> pending (task: $($promoted.task))" }
            } catch { Write-Output "WARN: queued decision promotion failed: $($_.Exception.Message)" }
            Write-PingState $s
        } finally { Exit-PingLock }
    }
    Write-Error "FAILED: decision notification did not succeed: $($_.Exception.Message)"
    exit 1
}
