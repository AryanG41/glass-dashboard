# Makes Glass Dashboard open automatically. Adds two things (undo with uninstall-startup.ps1):
#
#  1. Startup shortcut  -> opens when you sign in (after restart / sign-out)
#     %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Glass Dashboard.lnk
#
#  2. Scheduled task "Glass Dashboard (wake)" -> opens when you unlock the PC or it wakes from sleep
#     (wake = classic sleep event Power-Troubleshooter 1, or Modern Standby exit Kernel-Power 507)
#     (Task Scheduler Library, runs only as you, only while you're signed in)
#
# The launcher skips opening if the dashboard window is already open.

$here     = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $here 'start-dashboard.vbs'
$wscript  = Join-Path $env:WINDIR 'System32\wscript.exe'

# ---- 1. Startup shortcut ----
$startup = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startup 'Glass Dashboard.lnk'
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath       = $wscript
$lnk.Arguments        = '"' + $launcher + '"'
$lnk.WorkingDirectory = $here
$lnk.Description      = 'Glass Dashboard (clock, calendar, stocks)'
$lnk.IconLocation     = (Join-Path $here 'icon.ico') + ',0'
$lnk.Save()
Write-Output "Added startup shortcut: $lnkPath"

# ---- 2. Wake / unlock task ----
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$esc  = { param($s) [System.Security.SecurityElement]::Escape($s) }
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Opens Glass Dashboard when you unlock or wake the PC.</Description></RegistrationInfo>
  <Triggers>
    <SessionStateChangeTrigger>
      <Enabled>true</Enabled>
      <StateChange>SessionUnlock</StateChange>
      <UserId>$(& $esc $user)</UserId>
    </SessionStateChangeTrigger>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Delay>PT3S</Delay>
      <Subscription>&lt;QueryList&gt;&lt;Query Id="0" Path="System"&gt;&lt;Select Path="System"&gt;*[System[(Provider[@Name='Microsoft-Windows-Power-Troubleshooter'] and EventID=1) or (Provider[@Name='Microsoft-Windows-Kernel-Power'] and EventID=507)]]&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;</Subscription>
    </EventTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$(& $esc $user)</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT2M</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$(& $esc $wscript)</Command>
      <Arguments>"$(& $esc $launcher)"</Arguments>
      <WorkingDirectory>$(& $esc $here)</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
Register-ScheduledTask -TaskName 'Glass Dashboard (wake)' -Xml $xml -Force | Out-Null
Write-Output "Added scheduled task: Glass Dashboard (wake)  (runs on unlock and on wake from sleep)"
