$json = Get-Content -Raw -Path ".\MS_2026_export.json" | ConvertFrom-Json
$unplayed = $json.matches | Where-Object { $null -eq $_.result -or $_.result -eq "" }
Write-Host "Unplayed matches count: $($unplayed.Count)"
foreach ($m in $unplayed) {
    Write-Host "ID: $($m.id) | $($m.homeTeam) - $($m.awayTeam) | Date: $($m.date) | Result: '$($m.result)'"
}
