$r = Invoke-WebRequest -Uri 'https://prestamos-backend-production-1c7d.up.railway.app' -UseBasicParsing
Write-Host "Status: $($r.StatusCode)"
$saas = [regex]::Matches($r.Content, 'logout-btn-saas').Count
$v99  = [regex]::Matches($r.Content, 'v=99').Count
Write-Host "logout-btn-saas: $saas"
Write-Host "app.js v=99: $v99"
