param([switch]$NoBrowser)
$ErrorActionPreference='Stop'
$appRoot=$PSScriptRoot
$url='http://127.0.0.1:43127'
try { $health=Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 2; if($health.app -eq 'paperleaf'){if(-not $NoBrowser){Start-Process $url};exit} } catch {}
$runtime=Join-Path $appRoot 'runtime\node.exe'
if(-not (Test-Path -LiteralPath $runtime)) { $runtime=(Get-Command node -ErrorAction Stop).Source }
$data=Join-Path $appRoot 'data'
New-Item -ItemType Directory -Path $data -Force | Out-Null
$process=Start-Process -FilePath $runtime -ArgumentList ('"'+(Join-Path $appRoot 'server.mjs')+'"') -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'server.log') -RedirectStandardError (Join-Path $data 'server-error.log') -PassThru
$process.Id | Set-Content -LiteralPath (Join-Path $data 'server.pid') -Encoding ascii
for($i=0;$i -lt 30;$i++){Start-Sleep -Milliseconds 300;try{$health=Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 1;if($health.app -eq 'paperleaf'){if(-not $NoBrowser){Start-Process $url};exit}}catch{};if($process.HasExited){break}}
throw 'Paperleaf could not start. Check data/server-error.log or whether port 43127 is occupied.'
