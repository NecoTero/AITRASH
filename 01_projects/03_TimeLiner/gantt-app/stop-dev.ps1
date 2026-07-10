$ports = @(5173, 8000)

foreach ($port in $ports) {
  $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    if ($connection.OwningProcess) {
      Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
}

Write-Host "Stopped TimeLiner dev servers on ports 5173 and 8000."

