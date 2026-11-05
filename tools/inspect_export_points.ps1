$json = Get-Content -Raw -Path ".\MS_2026_export.json" | ConvertFrom-Json
$players = $json.players
$tips = $json.tips
$matches = $json.matches

foreach ($p in $players) {
    $points = 0
    $correct102 = 0
    $correctScore = 0
    
    foreach ($m in $matches) {
        if ($null -eq $m.result -or $m.result -eq "") { continue }
        
        $pTip = $tips | Where-Object { $_.matchId -eq $m.id -and $_.playerName -eq $p }
        if ($null -ne $pTip) {
            # Check 1-0-2 outcome
            if ($pTip.tipType -eq $m.resultType) {
                $points += 1
                $correct102 += 1
            }
            # Check exact score
            if ($pTip.tipScore -eq $m.result) {
                $points += 3
                $correctScore += 1
            }
        }
    }
    Write-Host "$p | Points: $points | 102: $correct102 | Score: $correctScore"
}
