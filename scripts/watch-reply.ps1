<#
.SYNOPSIS
    Listen for phone-tap replies. Exits 0 on RESPONSE_RECEIVED, 1 on timeout.
.EXAMPLE
    .\watch-reply.ps1 -DurationSeconds 600
#>
param([ValidateRange(1, 86400)][int]$DurationSeconds = 600)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$config = Get-PingConfig
$reply = $config.replyTopic; $outbound = $config.outboundTopic
$deadline = (Get-Date).AddSeconds($DurationSeconds)

while ((Get-Date) -lt $deadline) {
    $since = 'all'
    if (-not (Enter-PingLock -TimeoutSeconds 30)) { throw 'lock busy' }
    try {
        $s = Read-PingState
        if (-not $s.listener) { $s.listener = [pscustomobject]@{ lastMessageId = '' } }
        if ($s.listener.lastMessageId) { $since = $s.listener.lastMessageId }
        $changed = $false
        foreach ($d in @($s.decisions)) {
            if ($d.status -eq 'pending' -and $d.expiresAt) {
                try {
                    if ([datetime]::Parse($d.expiresAt) -lt (Get-Date)) { $d.status = 'expired'; $changed = $true }
                } catch { $d.status = 'expired'; $changed = $true }
            }
        }
        try {
            $promoted = Promote-PingWaiting -State $s -OutboundTopic $outbound -ReplyTopic $reply
            if ($promoted) { $changed = $true; Write-Output "PROMOTED_WAITING: $($promoted.decisionId) -> pending (task: $($promoted.task))" }
        } catch { Write-Output "LISTENER_ERR: queued decision promotion failed: $($_.Exception.Message)" }
        if ($changed) { Write-PingState $s }
    } finally { Exit-PingLock }

    $raw = & curl.exe -s --max-time 20 "https://ntfy.sh/$reply/json?poll=1&since=$since" 2>$null
    $lines = @($raw -split "`n" | Where-Object { $_ -match '^\{"id"' })
    if (-not (Enter-PingLock -TimeoutSeconds 30)) { throw 'lock busy' }
    try {
        $s = Read-PingState
        if (-not $s.listener) { $s.listener = [pscustomobject]@{ lastMessageId = '' } }
        $changed = $false
        $received = @()
        foreach ($line in $lines) {
            try { $o = $line | ConvertFrom-Json } catch { continue }
            if (-not $o.id) { continue }
            $s.listener.lastMessageId = $o.id
            $changed = $true
            if ($o.message -notmatch '^decision=([0-9a-f]{16})&option=(.+)$') { continue }
            $did = $Matches[1]
            try { $ans = [uri]::UnescapeDataString($Matches[2]) } catch { continue }
            $d = $s.decisions | Where-Object { $_.decisionId -eq $did } | Select-Object -First 1
            if (-not $d -or $d.status -ne 'pending') { continue }
            try {
                if ($d.expiresAt -and [datetime]::Parse($d.expiresAt) -lt (Get-Date)) {
                    $d.status = 'expired'; $changed = $true
                    try {
                        $promoted = Promote-PingWaiting -State $s -OutboundTopic $outbound -ReplyTopic $reply
                        if ($promoted) { $changed = $true; Write-Output "PROMOTED_WAITING: $($promoted.decisionId) -> pending (task: $($promoted.task))" }
                    } catch { Write-Output "LISTENER_ERR: queued decision promotion failed: $($_.Exception.Message)" }
                    continue
                }
            } catch {
                $d.status = 'expired'; $changed = $true
                try {
                    $promoted = Promote-PingWaiting -State $s -OutboundTopic $outbound -ReplyTopic $reply
                    if ($promoted) { $changed = $true; Write-Output "PROMOTED_WAITING: $($promoted.decisionId) -> pending (task: $($promoted.task))" }
                } catch { Write-Output "LISTENER_ERR: queued decision promotion failed: $($_.Exception.Message)" }
                continue
            }
            if (@($d.options | Where-Object { [string]$_ -eq $ans }).Count -eq 0) { continue }
            $d.status = 'answered'
            $d.response = [pscustomobject]@{ option = $ans; messageId = $o.id; time = $o.time }
            $d.replyMessageId = $o.id
            $received += [pscustomobject]@{ decisionId = $did; option = $ans; messageId = $o.id; task = $d.task }
            $changed = $true
            try {
                $promoted = Promote-PingWaiting -State $s -OutboundTopic $outbound -ReplyTopic $reply
                if ($promoted) { $changed = $true; Write-Output "PROMOTED_WAITING: $($promoted.decisionId) -> pending (task: $($promoted.task))" }
            } catch { Write-Output "LISTENER_ERR: queued decision promotion failed: $($_.Exception.Message)" }
        }
        if ($changed) { Write-PingState $s }
        if ($received.Count -gt 0) {
            foreach ($answer in $received) {
                Write-Output "RESPONSE_RECEIVED: decision=$($answer.decisionId)&option=$($answer.option) (task: $($answer.task))"
                Write-Output "DECISION_ID=$($answer.decisionId)"; Write-Output "OPTION=$($answer.option)"; Write-Output "MESSAGE_ID=$($answer.messageId)"
            }
            exit 0
        }
    } finally { Exit-PingLock }
    if ((Get-Date) -lt $deadline) { Start-Sleep -Seconds 3 }
}
Write-Output 'TIMEOUT_NO_RESPONSE'; exit 1
