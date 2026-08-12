[Setup]
AppName=CilamAI
AppVersion=1.0.1
AppPublisher=CilamAI
DefaultDirName={localappdata}\CilamAI
DefaultGroupName=CilamAI
OutputBaseFilename=CilamAI-Setup
OutputDir=..\Output
Compression=lzma2/ultra64
SolidCompression=yes
SetupIconFile=..\resources\icon.ico
UninstallDisplayIcon={app}\CilamAI.exe
WizardStyle=modern dynamic windows11 includetitlebar
WizardSizePercent=110
DisableWelcomePage=no
LicenseFile=..\LICENSE
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
VersionInfoVersion=1.0.1.0
VersionInfoCompany=CilamAI
VersionInfoDescription=CilamAI Setup
VersionInfoProductName=CilamAI
VersionInfoProductVersion=1.0.1
WizardImageFile=..\resources\sidebar.bmp
WizardSmallImageFile=..\resources\installer-small.bmp

[Files]
Source: "..\release\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\CilamAI"; Filename: "{app}\CilamAI.exe"; IconFilename: "{app}\CilamAI.exe"
Name: "{group}\Uninstall CilamAI"; Filename: "{uninstallexe}"
Name: "{autodesktop}\CilamAI"; Filename: "{app}\CilamAI.exe"; IconFilename: "{app}\CilamAI.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop icon"; GroupDescription: "Additional icons:"; Flags: unchecked

[Run]
Filename: "{app}\CilamAI.exe"; Description: "Launch CilamAI"; Flags: nowait postinstall skipifsilent

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssInstall then
  begin
    Exec('taskkill', '/F /IM CilamAI.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    Exec('taskkill', '/F /IM CilamAI.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;
