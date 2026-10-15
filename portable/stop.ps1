$ErrorActionPreference='Stop'
$pidFile=Join-Path $PSScriptRoot 'data\server.pid'
if(Test-Path -LiteralPath $pidFile){
 $serverPid=[int](Get-Content -LiteralPath $pidFile)
 $proc=Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue
 $entry=Join-Path $PSScriptRoot 'server.mjs'
 if($proc -and $proc.CommandLine -and $proc.CommandLine.Contains($entry)){Stop-Process -Id $serverPid -ErrorAction SilentlyContinue}
 Remove-Item -LiteralPath $pidFile -Force
}
