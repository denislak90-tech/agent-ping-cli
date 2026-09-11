$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$state = Join-Path $env:TEMP ("agent-ping-smoke-" + [guid]::NewGuid().ToString('N') + '.json')
$env:AGENT_PING_STATE = $state
try {
    . (Join-Path $root 'scripts\common.ps1')

    $s = Read-PingState
    if ($s.decisions.Count -ne 0) { throw 'new state was not empty' }
    $s.decisions += [pscustomobject]@{
        decisionId = '1111111111111111'; task = 'first'; question = 'q'; options = @('A','B');
        createdAt = (Get-Date).AddMinutes(-2).ToString('o'); expiresAt = (Get-Date).AddMinutes(10).ToString('o');
        status = 'answered'; response = $null
    }
    $s.decisions += [pscustomobject]@{
        decisionId = '2222222222222222'; task = 'second'; question = 'q'; options = @('A','B');
        createdAt = (Get-Date).AddMinutes(-1).ToString('o'); status = 'waiting'; expiryMinutes = 5; priority = 5; response = $null
    }

    $script:sentPriority = $null
    function Send-PingDecision { param($DecisionId, $TaskName, $Question, $Options, $OutboundTopic, $ReplyTopic, $PriorityNum) $script:sentPriority = $PriorityNum; return '' }
    $promoted = Promote-PingWaiting -State $s -OutboundTopic 'outbound-test-topic' -ReplyTopic 'reply-test-topic'
    if (-not $promoted -or $promoted.status -ne 'pending') { throw 'waiting decision was not promoted' }
    if (@($s.decisions | Where-Object { $_.status -eq 'pending' }).Count -ne 1) { throw 'promotion did not create one pending decision' }
    if ($promoted.priority -ne 5) { throw "promoted decision lost its original priority (expected 5, got $($promoted.priority))" }
    if ($script:sentPriority -ne 5) { throw "promotion sent the wrong priority to Send-PingDecision (expected 5, got $script:sentPriority)" }

    $expired = [pscustomobject]@{ decisionId = '3333333333333333'; task = 'expired'; options = @('A','B'); status = 'pending'; expiresAt = (Get-Date).AddMinutes(-1).ToString('o') }
    if ([datetime]::Parse($expired.expiresAt) -ge (Get-Date)) { throw 'expiry clock check failed' }

    $configPath = Join-Path $root 'config.json'
    $configBackup = $null
    if (Test-Path -LiteralPath $configPath) { $configBackup = Get-Content -LiteralPath $configPath -Raw }
    try {
        '{"outboundTopic":"same-test-topic","replyTopic":"same-test-topic"}' | Set-Content -LiteralPath $configPath -Encoding UTF8
        try { Get-PingConfig | Out-Null; throw 'same outbound/reply topic was accepted' } catch { if ($_.Exception.Message -like '*same outbound*') { throw } }
    }
    finally {
        if ($null -ne $configBackup) { [System.IO.File]::WriteAllText($configPath, $configBackup) }
        elseif (Test-Path -LiteralPath $configPath) { Remove-Item -LiteralPath $configPath -Force }
    }
    Write-Output 'SMOKE_OK'
}
finally {
    Remove-Item Env:AGENT_PING_STATE -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $state) { Remove-Item -LiteralPath $state -Force }
    $lock = Join-Path (Split-Path -Parent $state) 'decisions.lock'
    if (Test-Path -LiteralPath $lock) { Remove-Item -LiteralPath $lock -Force }
}
