; Register jumzi:// links when JUMZI is installed (before it is ever opened), and remove them on uninstall.
!macro customInstall
  WriteRegStr SHCTX "Software\Classes\jumzi" "" "URL:JUMZI"
  WriteRegStr SHCTX "Software\Classes\jumzi" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\jumzi\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\jumzi\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\jumzi"
!macroend
