' Glass Dashboard - startup launcher
' -----------------------------------
' 1. Starts the local server (server.py) silently with pythonw (no console window).
'    If it's already running, the second copy just exits.
' 2. Waits until http://127.0.0.1:47613 answers (max ~15 s).
' 3. Opens the dashboard fullscreen in Microsoft Edge kiosk mode (Alt+F4 closes it).
'
' Double-click this file to open the dashboard any time.
' install-startup.ps1 puts a shortcut to this file in your Windows Startup folder.
' (If you change "port" in config.json, change PORT below too.)

Option Explicit
Const PORT = 47613

Dim sh, fso, here, url, http, i, ready, edge
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://127.0.0.1:" & PORT & "/"

' --- start the server (hidden) ---
sh.CurrentDirectory = here
sh.Run "pythonw """ & here & "\server.py""", 0, False

' --- wait until it responds ---
ready = False
For i = 1 To 60
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 500, 500, 500, 500
  http.Open "GET", url & "api/health", False
  http.Send
  If Err.Number = 0 Then
    If http.Status = 200 Then ready = True
  End If
  Err.Clear
  On Error GoTo 0
  If ready Then Exit For
  WScript.Sleep 250
Next

' --- already open? bring it to the front instead of opening a second window ---
' (matches the visible window title "Glass - [InPrivate] - Microsoft Edge")
If sh.AppActivate("Glass - [InPrivate]") Then WScript.Quit

' --- find Edge ---
edge = ""
If fso.FileExists(sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe") Then
  edge = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
ElseIf fso.FileExists(sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe") Then
  edge = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe"
End If
If edge = "" Then
  sh.Run url, 1, False  ' no Edge: fall back to the default browser
  WScript.Quit
End If

' Kiosk fullscreen = no title bar, and always fullscreen (plain --start-fullscreen
' gets overridden by Edge's remembered window size). Alt+F4 closes it.
' A dedicated profile folder keeps this separate from your normal Edge.
Dim profile, cmd, attempt
profile = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\GlassDashboard\edge-profile"
cmd = """" & edge & """ --kiosk " & url & " --edge-kiosk-type=fullscreen --user-data-dir=""" & profile & """ --no-first-run --no-default-browser-check"

For attempt = 1 To 2
  ' A closed dashboard can leave hidden Edge processes for ~15 s; they swallow a new
  ' launch without showing a window. Clear them (dashboard profile only) and wait.
  ClearLeftovers
  sh.Run cmd, 1, False
  If WaitForWindow(10) Then WScript.Quit
Next

' ---------------------------------------------------------------- helpers
Function DashboardPids()
  ' process ids of Edge processes using the dashboard's own profile folder
  Dim wmi, p, list
  list = ""
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  For Each p In wmi.ExecQuery("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='msedge.exe'")
    If Not IsNull(p.CommandLine) Then
      If InStr(1, p.CommandLine, "GlassDashboard\edge-profile", vbTextCompare) > 0 Then list = list & p.ProcessId & " "
    End If
  Next
  DashboardPids = Trim(list)
End Function

Sub ClearLeftovers()
  Dim pid, i
  If DashboardPids() = "" Then Exit Sub
  For Each pid In Split(DashboardPids(), " ")
    sh.Run "taskkill /F /PID " & pid, 0, True
  Next
  For i = 1 To 40                       ' up to 10 s for them to be gone
    If DashboardPids() = "" Then Exit For
    WScript.Sleep 250
  Next
  WScript.Sleep 500
End Sub

Function WaitForWindow(seconds)
  Dim i
  WaitForWindow = False
  For i = 1 To seconds * 4
    WScript.Sleep 250
    If sh.AppActivate("Glass - [InPrivate]") Then
      WaitForWindow = True
      Exit Function
    End If
  Next
End Function
