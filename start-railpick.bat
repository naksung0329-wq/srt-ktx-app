@echo off
chcp 65001 > nul
title RailPick — Server + Tunnel
echo.
echo ===============================================
echo  RailPick - Local Server + Cloudflare Tunnel
echo ===============================================
echo.

set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe;%PATH%"
cd /d "%~dp0"

echo [1/3] 기존 프로세스 정리...
taskkill /F /IM node.exe 2>nul
taskkill /F /IM cloudflared.exe 2>nul
timeout /t 2 /nobreak > nul

echo [2/3] 서버 빌드 + 시작 (production 모드)...
if not exist ".next\BUILD_ID" (
  echo    빌드 중... (최초 1회만, 30~60초 소요)
  call npm run build
  if errorlevel 1 (
    echo 빌드 실패. 종료.
    pause
    exit /b 1
  )
)
start "RailPick Server" cmd /c "title RailPick Server & npm run start"
echo    서버 시작 대기 (10초)...
timeout /t 10 /nobreak > nul

echo [3/3] Cloudflare 터널 시작...
echo.
echo === 잠시 후 표시되는 https://*.trycloudflare.com URL을 ===
echo === 모바일에서 열면 됩니다 (이 창 켜둔 채로) ===
echo.
cloudflared tunnel --url http://localhost:3000 --no-autoupdate
