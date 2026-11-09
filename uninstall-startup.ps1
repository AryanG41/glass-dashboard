# Removes the Glass Dashboard startup shortcut and stops the local server if it's running.

$lnkPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Glass Dashboard.lnk'
if (Test-Path $lnkPath) {
  Remove-Item $lnkPath
  Write-Output "Removed startup shortcut: $lnkPath"
} else {
  Write-Output "No startup shortcut found at: $lnkPath"
}

if (Get-ScheduledTask -TaskName 'Glass Dashboard (wake)' -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName 'Glass Dashboard (wake)' -Confirm:$false
  Write-Output "Removed scheduled task: Glass Dashboard (wake)"
}

# Stop the background server (pythonw running this folder's server.py).
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Get-CimInstance Win32_Process -Filter "Name='pythonw.exe'" |
  Where-Object { $_.CommandLine -like "*$here\server.py*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId; Write-Output "Stopped server (PID $($_.ProcessId))" }
