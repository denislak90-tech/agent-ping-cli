<#
.SYNOPSIS
    Shared helpers: config, state, file lock. No secrets inside.
    Copy config.example.json -> config.json with your own ntfy topics.
#>
$script:Root = Split-Path -Parent $PSScriptRoot
$script:ConfigPath = Join-Path $script:Root 'config.json'
$script:StatePath = if ($env:AGENT_PING_STATE) { $env:AGENT_PING_STATE } else { Join-Path $script:Root 'state\decisions.json' }
$script:Lock = $null

function Get-PingConfig {
    if (-not (Test-Path -LiteralPath $script:ConfigPath)) {
        throw "config.json not found. Copy config.example.json to config.json and fill in your topics."
    }
    $config = Get-Content -LiteralPath $script:ConfigPath -Raw | ConvertFrom-Json
    if (-not $config.outboundTopic -or -not $config.replyTopic -or
        $config.outboundTopic -like 'REPLACE*' -or $config.replyTopic -like 'REPLACE*' -or
        $config.outboundTopic -notmatch '^[A-Za-z0-9_-]{8,}$' -or $config.replyTopic -notmatch '^[A-Za-z0-9_-]{8,}$' -or
        $config.outboundTopic -eq $config.replyTopic) {
        throw 'config.json must contain non-placeholder outboundTopic and replyTopic values.'
    }
    return $config
}

function Read-PingState {
    if (Test-Path -LiteralPath $script:StatePath) {
        return Get-Content -LiteralPath $script:StatePath -Raw | ConvertFrom-Json
    }
    return [pscustomobject]@{ listener = [pscustomobject]@{ lastMessageId = '' }; decisions = @() }
}

function Write-PingState($state) {
    $dir = Split-Path -Parent $script:StatePath
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $tmp = "$script:StatePath.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        [System.IO.File]::WriteAllText($tmp, ($state | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $tmp -Destination $script:StatePath -Force
    }
    finally {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
    }
}

function Enter-PingLock {
    param([int]$TimeoutSeconds = 30)
    $lockPath = Join-Path (Split-Path -Parent $script:StatePath) 'decisions.lock'
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        try {
            $script:Lock = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
            return $true
        } catch { Start-Sleep -Milliseconds 200 }
    }
    return $false
}

function Exit-PingLock {
    if ($null -ne $script:Lock) { $script:Lock.Close(); $script:Lock.Dispose(); $script:Lock = $null }
}

function Send-PingDecision {
    param(
        [Parameter(Mandatory = $true)][string]$DecisionId,
        [Parameter(Mandatory = $true)][string]$TaskName,
        [Parameter(Mandatory = $true)][string]$Question,
        [Parameter(Mandatory = $true)][string[]]$Options,
        [Parameter(Mandatory = $true)][string]$OutboundTopic,
        [Parameter(Mandatory = $true)][string]$ReplyTopic,
        [int]$PriorityNum = 4
    )
    $labels = @('A', 'B', 'C')
    $actions = @()
    for ($i = 0; $i -lt $Options.Count -and $i -lt 3; $i++) {
        $encodedId = [uri]::EscapeDataString($DecisionId)
        $encodedOption = [uri]::EscapeDataString($Options[$i])
        $actions += @{
            action = 'http'
            label  = "$($labels[$i]) - $($Options[$i])"
            method = 'POST'
            url    = "https://ntfy.sh/$ReplyTopic"
            body   = "decision=$encodedId&option=$encodedOption"
        }
    }
    $body = @{
        topic    = $OutboundTopic
        title    = "Needs a decision - $TaskName"
        message  = $Question
        priority = $PriorityNum
        actions  = $actions
    } | ConvertTo-Json -Depth 5
    $tmp = Join-Path $env:TEMP ("ping-d-" + [guid]::NewGuid().ToString('N') + ".json")
    [System.IO.File]::WriteAllText($tmp, $body, (New-Object System.Text.UTF8Encoding($false)))
    try {
        $out = & curl.exe -s --max-time 20 -w "`nHTTP %{http_code}" -H "Content-Type: application/json" --data-binary "@$tmp" "https://ntfy.sh" 2>&1
        if ($LASTEXITCODE -ne 0) { throw "curl exited $LASTEXITCODE : $out" }
        $status = ($out -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^HTTP \d{3}$' } | Select-Object -Last 1)
        if (-not $status -or $status -notmatch '^HTTP 2\d\d$') { throw "ntfy returned $status" }
        return $out
    }
    finally {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
    }
}

function Promote-PingWaiting {
    param(
        [Parameter(Mandatory = $true)]$State,
        [Parameter(Mandatory = $true)][string]$OutboundTopic,
        [Parameter(Mandatory = $true)][string]$ReplyTopic,
        [int]$PriorityNum = 4
    )
    $pending = @($State.decisions | Where-Object { $_.status -eq 'pending' })
    if ($pending.Count -gt 0) { return $null }
    $waiting = @($State.decisions | Where-Object { $_.status -eq 'waiting' } | Sort-Object createdAt)
    if ($waiting.Count -eq 0) { return $null }
    $old = $waiting[0]
    $expiry = 720
    if ($old.expiryMinutes) { $expiry = [int]$old.expiryMinutes }
    $priority = $PriorityNum
    if ($old.priority) { $priority = [int]$old.priority }
    $promoted = [pscustomobject]@{
        decisionId = $old.decisionId
        task = $old.task
        question = $old.question
        options = @($old.options)
        createdAt = $old.createdAt
        expiresAt = (Get-Date).AddMinutes($expiry).ToString('o')
        status = 'pending'
        promotedAt = (Get-Date).ToString('o')
        expiryMinutes = $expiry
        priority = $priority
        response = $null
        replyMessageId = $null
    }
    Send-PingDecision -DecisionId $promoted.decisionId -TaskName $promoted.task -Question $promoted.question -Options $promoted.options -OutboundTopic $OutboundTopic -ReplyTopic $ReplyTopic -PriorityNum $promoted.priority | Out-Null
    $State.decisions = @($State.decisions | ForEach-Object {
        if ($_.decisionId -eq $old.decisionId) { $promoted } else { $_ }
    })
    return $promoted
}
