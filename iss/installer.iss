[Setup]
AppName=CilamAI
AppVersion=0.1.0.1
AppPublisher=CilamAI
DefaultDirName={localappdata}\CilamAI
DefaultGroupName=CilamAI
OutputBaseFilename=CilamAI-Setup
OutputDir=..\Output
Compression=lzma2/ultra64
SolidCompression=yes
SetupIconFile=..\resources\icon.ico
UninstallDisplayName=CilamAI
UninstallDisplayIcon={app}\CilamAI.exe
WizardStyle=classic
WizardSizePercent=110
DisableWelcomePage=no
LicenseFile=..\LICENSE
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
VersionInfoVersion=0.1.0.1
VersionInfoCompany=CilamAI
VersionInfoDescription=CilamAI Setup
VersionInfoProductName=CilamAI
VersionInfoProductVersion=0.1.0.1
WizardImageFile=..\resources\sidebar.bmp
WizardSmallImageFile=..\resources\installer-small.bmp
#ifdef SIGNTOOL
SignTool=mysigntool
SignedUninstaller=yes
#endif


[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
Name: "german"; MessagesFile: "compiler:Languages\German.isl"
Name: "portuguese"; MessagesFile: "compiler:Languages\Portuguese.isl"
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "italian"; MessagesFile: "compiler:Languages\Italian.isl"
Name: "arabic"; MessagesFile: "compiler:Languages\Arabic.isl"
Name: "polish"; MessagesFile: "compiler:Languages\Polish.isl"
Name: "ukrainian"; MessagesFile: "compiler:Languages\Ukrainian.isl"
Name: "dutch"; MessagesFile: "compiler:Languages\Dutch.isl"

[Files]
Source: "..\release_build\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\CilamAI"; Filename: "{app}\CilamAI.exe"; IconFilename: "{app}\CilamAI.exe"
Name: "{group}\Uninstall CilamAI"; Filename: "{uninstallexe}"
Name: "{autodesktop}\CilamAI"; Filename: "{app}\CilamAI.exe"; IconFilename: "{app}\CilamAI.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop icon"; GroupDescription: "Additional icons:"

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

procedure DeleteFolder();
var
  FindRec: TFindRec;
  fullPath: string;
  tmpMsg: string;
  StatusText: string;
  deletePath: string;
begin
  { find all and delete }
  UninstallProgressForm.ProgressBar.Style := npbstMarquee;       
  StatusText := UninstallProgressForm.StatusLabel.Caption;
  UninstallProgressForm.StatusLabel.WordWrap := True;
  UninstallProgressForm.StatusLabel.AutoSize := True;
  fullPath := ExpandConstant('{userappdata}\CilamAI');
  if FindFirst(ExpandConstant(fullPath + '\*'), FindRec) then 
  try
    repeat
      if (FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY <> 0) and 
         (FindRec.Name <> '.') and (FindRec.Name <> '..') then begin
            deletePath := AddBackslash(fullPath) + FindRec.Name;
            tmpMsg := 'Deleting...' + #13#10 + deletePath;
            UninstallProgressForm.StatusLabel.Caption := tmpMsg;
            DelTree(deletePath, True, True, True);
        end;
    until
      not FindNext(FindRec);
  finally
    UninstallProgressForm.StatusLabel.Caption := StatusText;
    FindClose(FindRec);
  end;
  UninstallProgressForm.ProgressBar.Style := npbstNormal;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    Exec('taskkill', '/F /IM CilamAI.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    DeleteFolder();
  end;
end;

var
  ConfigPage: TWizardPage;
  ServiceLabel: TNewStaticText;
  UserLabel: TNewStaticText;
  UserEdit: TNewEdit;
  PasswordLabel: TNewStaticText;
  PasswordEdit: TNewEdit;
  ServicePermissionCheckBox: TNewCheckBox;

procedure InitializeWizard();
begin
  ConfigPage := CreateCustomPage(wpSelectDir, 'Configuration', 'Dashboard service');

  ServiceLabel := TNewStaticText.Create(ConfigPage);
  ServiceLabel.Parent := ConfigPage.Surface;
  ServiceLabel.Caption := 'Dashboard service';
  ServiceLabel.Font.Style := [fsBold];
  ServiceLabel.Left := ScaleX(0);
  ServiceLabel.Top := ScaleY(10);

  UserLabel := TNewStaticText.Create(ConfigPage);
  UserLabel.Parent := ConfigPage.Surface;
  UserLabel.Caption := 'Windows account username (Domain\Username):';
  UserLabel.Left := ScaleX(0);
  UserLabel.Top := ScaleY(40);

  UserEdit := TNewEdit.Create(ConfigPage);
  UserEdit.Parent := ConfigPage.Surface;
  UserEdit.Left := ScaleX(0);
  UserEdit.Top := ScaleY(60);
  UserEdit.Width := ConfigPage.SurfaceWidth;

  PasswordLabel := TNewStaticText.Create(ConfigPage);
  PasswordLabel.Parent := ConfigPage.Surface;
  PasswordLabel.Caption := 'Windows account password:';
  PasswordLabel.Left := ScaleX(0);
  PasswordLabel.Top := ScaleY(95);

  PasswordEdit := TNewEdit.Create(ConfigPage);
  PasswordEdit.Parent := ConfigPage.Surface;
  PasswordEdit.PasswordChar := '*';
  PasswordEdit.Left := ScaleX(0);
  PasswordEdit.Top := ScaleY(115);
  PasswordEdit.Width := ConfigPage.SurfaceWidth;

  ServicePermissionCheckBox := TNewCheckBox.Create(ConfigPage);
  ServicePermissionCheckBox.Parent := ConfigPage.Surface;
  ServicePermissionCheckBox.Caption := 'Add "Log on as a service" permission';
  ServicePermissionCheckBox.Checked := True;
  ServicePermissionCheckBox.Left := ScaleX(0);
  ServicePermissionCheckBox.Top := ScaleY(160);
  ServicePermissionCheckBox.Width := ConfigPage.SurfaceWidth;
end;
