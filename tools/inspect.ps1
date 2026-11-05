$json = Get-Content -Raw -Path ".\MS_2026_export.json" | ConvertFrom-Json
Write-Host "Tournament: $($json.name)"
Write-Host "Total matches: $($json.matches.Count)"
$matched = $json.matches | Where-Object { $_.homeTeam -match "Velká Británie|Dánsko|Finsko|Slovensko" }
foreach ($m in $matched) {
    Write-Host "Match ID: $($m.id) | $($m.homeTeam) - $($m.awayTeam) | Date: $($m.date) | Result: $($m.result) | ResultType: $($m.resultType)"
}
