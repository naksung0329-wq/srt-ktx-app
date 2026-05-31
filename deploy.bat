@echo off
set PATH=C:\Program Files\nodejs;C:\Users\User\AppData\Roaming\npm;%PATH%
cd /d "%~dp0"
echo Current dir: %CD%
node --version
"C:\Program Files\nodejs\node.exe" "C:\Users\User\AppData\Roaming\npm\node_modules\vercel\dist\vc.js" deploy --prod --yes
