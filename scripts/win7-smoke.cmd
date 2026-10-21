@echo off
setlocal
set "ROOT=%LOCALAPPDATA%\Airpimo"
set "GST=%ROOT%\gstreamer"
set "PATH=%GST%\bin;%ROOT%\sidecar;%PATH%"
set "GST_PLUGIN_PATH_1_0=%GST%\lib\gstreamer-1.0"
set "GST_PLUGIN_SYSTEM_PATH_1_0=%GST_PLUGIN_PATH_1_0%"
set "GST_PLUGIN_SCANNER_1_0=%GST%\libexec\gstreamer-1.0\gst-plugin-scanner.exe"
set "GST_REGISTRY_1_0=%TEMP%\uxplay-win7-smoke-registry.bin"
if not exist "%ROOT%\sidecar\uxplay.exe" goto :missing
if not exist "%GST%\bin\gst-inspect-1.0.exe" goto :missing
for %%E in (libav avdec_h264 avdec_aac) do (
  echo Checking GStreamer: %%E
  "%GST%\bin\gst-inspect-1.0.exe" %%E >nul 2>"%TEMP%\uxplay-gst-last-error.log"
  if errorlevel 1 (
    echo FAIL: %%E failed to load. Details: %TEMP%\uxplay-gst-last-error.log
    type "%TEMP%\uxplay-gst-last-error.log"
    exit /b 2
  )
)
"%ROOT%\sidecar\uxplay.exe" -h >nul 2>&1
if errorlevel 1 (
  echo FAIL: UxPlay sidecar does not start on this computer.
  exit /b 2
)
echo PASS: Required plugins and UxPlay -h load on this machine.
echo NEXT: Check Bonjour/mDNS, AirPlay discovery and actual video/audio.
exit /b 0
:missing
echo FAIL: Airpimo installation directory is missing bundled engine/GStreamer.
exit /b 2
