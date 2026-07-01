!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER

Var CleanInstallCheckbox
Var CleanInstallState

!macro customPageAfterChangeDir
  Page custom CleanInstallPage CleanInstallPageLeave
!macroend

Function CleanInstallPage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 34u "Clean install option$\r$\nUse this only when you want to remove the old local database, license cache, side-device config, and app settings from Roaming before installing."
  Pop $0

  ${NSD_CreateCheckbox} 0 48u 100% 14u "Clean install: delete old SHIFT POS Roaming data"
  Pop $CleanInstallCheckbox
  ${NSD_SetState} $CleanInstallCheckbox ${BST_UNCHECKED}

  ${NSD_CreateLabel} 0 72u 100% 36u "WARNING: this deletes local POS data from this Windows user profile. Create a backup first if you need the old database."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function CleanInstallPageLeave
  ${NSD_GetState} $CleanInstallCheckbox $CleanInstallState
  ${If} $CleanInstallState == ${BST_CHECKED}
    MessageBox MB_ICONEXCLAMATION|MB_YESNO "Clean install will delete old SHIFT POS data from Roaming, including the SQLite database and local settings. Continue?" IDYES +2
    Abort
  ${EndIf}
FunctionEnd

!macro customInstall
  ${If} $CleanInstallState == ${BST_CHECKED}
    RMDir /r "$APPDATA\shift-pos"
    RMDir /r "$APPDATA\SHIFT POS"
    RMDir /r "$APPDATA\abdokofta-pos"
  ${EndIf}
!macroend

!endif

!macro customUnInstall
!macroend
