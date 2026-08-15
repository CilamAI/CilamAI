!macro customHeader
  ShowInstDetails show
  ShowUnInstDetails show
!macroend

!macro customInstall
  SetDetailsPrint both
  DetailPrint "Installing resource files..."
  DetailPrint "Extract: CilamAI.exe"
  DetailPrint "Extract: app.asar"
  DetailPrint "Extract: ffmpeg.dll"
  DetailPrint "Extract: v8_context_snapshot.bin"
  DetailPrint "Extract: resources.pak"
  DetailPrint "Extract: icudtl.dat"
  DetailPrint "Extract: locales\"
  DetailPrint "Extract: d3dcompiler_47.dll"
  DetailPrint "Extract: vk_swiftshader.dll"
  DetailPrint "Extract: vk_swiftshader_icd.json"
  DetailPrint "Extract: vulkan-1.dll"
  DetailPrint "Registering application icons and shortcuts..."
  DetailPrint "Installation Complete. Setup was completed successfully."
!macroend

!macro customUnInstall
  SetDetailsPrint both
  DetailPrint "Removing CilamAI application files..."
  DetailPrint "Cleaning cached data..."
  DetailPrint "Removing shortcuts..."
  DetailPrint "Uninstallation Complete."
!macroend
